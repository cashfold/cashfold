import { EventEmitter } from 'node:events';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Controller, Get } from '@nestjs/common';
import { Public, ResponseInterceptor } from './common/http.js';
import { RelayExceptionFilter } from './common/filters.js';
import { createRateLimiter, type Clock, type RateLimiter } from './common/rate-limit.js';
import { T } from './common/tokens.js';
import { DEFAULT_TRUST_PROXY, type ServerConfig } from './config.js';
import { AccountsController } from './modules/accounts/accounts.controller.js';
import { createAccountsService } from './modules/accounts/accounts.service.js';
import { AttachmentsController } from './modules/attachments/attachments.controller.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { FrameGuard } from './modules/auth/frame.guard.js';
import { createSessionStore } from './modules/auth/sessions.js';
import { createSrpServer } from './modules/auth/srp-server.js';
import { DevicesController } from './modules/devices/devices.controller.js';
import { FoldsController } from './modules/folds/folds.controller.js';
import { createFoldsService } from './modules/folds/folds.service.js';
import { attachStream } from './modules/folds/stream.js';
import { createPruneJob, type PruneJob } from './modules/snapshots/prune.job.js';
import { createLogMailer, createSmtpMailer, lockoutMessage, noMailer, type Mailer } from './modules/mail/mail.js';
import { MembershipController } from './modules/membership/membership.controller.js';
import { createMembershipService } from './modules/membership/membership.service.js';
import { RatesController } from './modules/rates/rates.controller.js';
import { createRatesService } from './modules/rates/rates.service.js';
import type { Store } from './store/store.js';

@Controller()
class HealthController {
  @Public() @Get('healthz')
  health(): string {
    return 'ok';
  }
}

export interface RelayOptions {
  readonly config: ServerConfig;
  readonly store: Store;
  readonly clock?: Clock;
  readonly mail?: Mailer;
  readonly limiter?: RateLimiter;
  /** Replaces the network fetch of the rate table (tests). */
  readonly fetchRates?: (url: string) => Promise<string>;
}

@Module({})
class RelayModule {
  static register(providers: Array<{ provide: symbol; useValue: unknown }>): DynamicModule {
    return {
      module: RelayModule,
      controllers: [HealthController, AuthController, AccountsController, DevicesController, FoldsController, AttachmentsController, MembershipController, RatesController],
      providers: [
        ...providers,
        FrameGuard,
        { provide: APP_GUARD, useExisting: FrameGuard },
        { provide: APP_INTERCEPTOR, useValue: new ResponseInterceptor() },
        { provide: APP_FILTER, useValue: new RelayExceptionFilter() },
      ],
    };
  }
}

export interface Relay {
  readonly app: NestFastifyApplication;
  readonly services: { readonly rates: ReturnType<typeof createRatesService>; readonly store: Store; readonly events: EventEmitter; readonly pruneJob: PruneJob };
  close(): Promise<void>;
}

/** Builds the relay: services first (plain objects, testable alone), then the HTTP layer around them. */
export async function createRelay(options: RelayOptions): Promise<Relay> {
  const { config, store } = options;
  const clock = options.clock ?? { now: () => Date.now() };
  const mail = options.mail ?? (config.mail.kind === 'smtp' ? createSmtpMailer(config.mail.url, config.mail.from) : config.mail.kind === 'log' ? createLogMailer() : noMailer);
  const limiter = options.limiter ?? createRateLimiter(clock, config.rateLimitScale ?? 1);
  const sessions = createSessionStore(clock);
  const events = new EventEmitter();
  const srp = createSrpServer();
  const auth = createAuthService({
    store, srp, sessions, limiter, clock, secret: config.serverSecret, defaultKdf: config.defaultKdf,
    onLocked: (accountId) => void store.accounts.byId(accountId).then((a) => (a === undefined || !mail.enabled ? undefined : mail.send(lockoutMessage(a.email)))).catch(() => undefined),
  });
  const accounts = createAccountsService({ store, config, sessions, mail, clock, limiter });
  const folds = createFoldsService({ store, events });
  const membership = createMembershipService({ store, mail, clock, limiter, config });
  const rates = createRatesService({ store, config: config.rates, now: () => clock.now(), ...(options.fetchRates && { fetchText: options.fetchRates }) });

  const adapter = new FastifyAdapter({ bodyLimit: 6 * 1024 * 1024, trustProxy: trustProxyOf(config.trustProxy ?? DEFAULT_TRUST_PROXY) });
  const fastify = adapter.getInstance();
  for (const type of ['application/cbor', 'application/octet-stream']) fastify.addContentTypeParser(type, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  fastify.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin !== undefined && config.allowedOrigins.includes(origin)) {
      void reply.header('access-control-allow-origin', origin).header('vary', 'Origin').header('access-control-expose-headers', 'Retry-After');
      if (req.method === 'OPTIONS') {
        void reply.header('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS').header('access-control-allow-headers', 'content-type,x-cashfold-session,x-cashfold-frame,x-invite-code').header('access-control-max-age', '600');
        return reply.status(204).send();
      }
    }
    return undefined;
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    RelayModule.register([
      { provide: T.STORE, useValue: store }, { provide: T.AUTH, useValue: auth }, { provide: T.SESSIONS, useValue: sessions }, { provide: T.CONFIG, useValue: config },
      { provide: T.MAIL, useValue: mail }, { provide: T.LIMITER, useValue: limiter }, { provide: T.CLOCK, useValue: clock }, { provide: T.EVENTS, useValue: events },
      { provide: T.RATES, useValue: rates }, { provide: T.ACCOUNTS, useValue: accounts }, { provide: T.FOLDS, useValue: folds }, { provide: T.MEMBERSHIP, useValue: membership },
    ]),
    adapter,
    { logger: false },
  );
  await app.init();
  await fastify.ready();
  const detach = attachStream(fastify.server, { store, sessions, events });

  return {
    app,
    services: { rates, store, events, pruneJob: createPruneJob(store) },
    async close() {
      detach();
      await app.close();
      await store.close();
    },
  };
}

/** Fastify takes a hop count only as a function: trust the first `n` hops, counting the connection itself as hop 0. */
function trustProxyOf(setting: boolean | number | string): boolean | string | ((address: string, hop: number) => boolean) {
  return typeof setting === 'number' ? (_address, hop) => hop < setting : setting;
}
