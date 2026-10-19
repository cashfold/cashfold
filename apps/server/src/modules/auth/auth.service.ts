import { randomBytes } from 'node:crypto';
import { emailMac, fakeAccount } from '../../common/crypto-util.js';
import { createFailureTracker, type Clock, type RateLimiter } from '../../common/rate-limit.js';
import type { KdfRecord, Store } from '../../store/store.js';
import { createServerTransport } from './frame.js';
import { HANDSHAKE_MS, type SessionStore } from './sessions.js';
import type { SrpServer } from './srp-server.js';

export class AuthError extends Error {
  constructor(readonly kind: 'rejected' | 'rate_limited', readonly retryAfterSec?: number) {
    super(kind);
  }
}

export interface HelloReply {
  readonly accountId: string;
  readonly authSalt: Uint8Array;
  readonly kdf: KdfRecord;
  readonly sessionId: Uint8Array;
}

export interface AuthDeps {
  readonly store: Store;
  readonly srp: SrpServer;
  readonly sessions: SessionStore;
  readonly limiter: RateLimiter;
  readonly clock: Clock;
  readonly secret: Uint8Array;
  /** The parameters shown for an address with no account: the same ones real accounts get from this service. */
  readonly defaultKdf: { mKib: number; t: number; p: number };
  /** Told when an account becomes locked, so its owner can be notified. */
  readonly onLocked?: (accountId: string) => void;
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/**
 * The server's half of the sign-in handshake (contracts/auth-srp.md). Every failure after the first message is the same
 * rejection, an unknown address runs the same code with stand-in values, and failures back off per account and per address.
 */
export function createAuthService(deps: AuthDeps) {
  const { store, srp, sessions, limiter, clock, secret } = deps;
  const failures = createFailureTracker(clock);

  const reject = (): never => {
    throw new AuthError('rejected');
  };
  const limit = (key: string, max: number, windowMs: number): void => {
    const d = limiter.hit(key, max, windowMs);
    if (!d.allowed) throw new AuthError('rate_limited', d.retryAfterSec);
  };

  return {
    async hello({ email, deviceId, ip }: { email: string; deviceId: Uint8Array; ip: string }): Promise<HelloReply> {
      const mac = emailMac(secret, email);
      limit(`hello:ip:${ip}`, 30, 60_000);
      limit(`hello:email:${hex(mac)}`, 10, 60_000);

      const real = await store.accounts.byEmailHmac(mac);
      const stand = fakeAccount(secret, email, deps.defaultKdf);
      const accountId = real?.accountId ?? stand.accountId;
      const subject = `acct:${real === undefined ? hex(mac) : real.accountId}`;
      const wait = failures.waitMs(subject);
      if (wait > 0) throw new AuthError('rate_limited', Math.ceil(wait / 1000));

      if (real !== undefined) {
        const device = await store.devices.get(deviceId);
        // A revoked device is refused at the first message, and a device registered to someone else is treated as unknown.
        if (device !== undefined && device.accountId === real.accountId && device.revokedAtMs !== null) throw new AuthError('rejected');
      }

      const sessionId = randomBytes(16);
      const kdf: KdfRecord = real?.kdf ?? { ...stand.kdf, encSalt: stand.encSalt };
      sessions.startHandshake(hex(sessionId), {
        stage: 'salt_sent', expiresAt: clock.now() + HANDSHAKE_MS, accountId, real: real !== undefined, authSalt: real?.authSalt ?? stand.authSalt,
        deviceId, subject, ip, verifier: real?.srpVerifier ?? srp.verifierFrom(stand.verifierSeed),
      });
      return { accountId, authSalt: real?.authSalt ?? stand.authSalt, kdf, sessionId };
    },

    async proofA({ sessionId, A, ip }: { sessionId: Uint8Array; A: Uint8Array; ip: string }): Promise<{ B: Uint8Array }> {
      limit(`proof:ip:${ip}`, 60, 60_000);
      const id = hex(sessionId);
      const h = sessions.handshake(id);
      if (h === undefined || h.stage !== 'salt_sent') {
        sessions.end(id);
        return reject();
      }
      const exchange = srp.begin({ v: h.verifier, A });
      if (exchange === undefined) {
        sessions.end(id);
        failures.fail(h.subject);
        return reject();
      }
      sessions.startHandshake(id, { ...h, stage: 'b_sent', exchange });
      return { B: exchange.B };
    },

    async proofM1({ sessionId, M1, ip }: { sessionId: Uint8Array; M1: Uint8Array; ip: string }): Promise<{ M2: Uint8Array }> {
      limit(`proof:ip:${ip}`, 60, 60_000);
      const id = hex(sessionId);
      const h = sessions.takeHandshake(id);
      if (h === undefined || h.stage !== 'b_sent' || h.exchange === undefined) return reject();

      const done = h.exchange.finish({ accountId: h.accountId, authSalt: h.authSalt, M1 });
      if (!done.ok || !h.real) {
        const f = failures.fail(h.subject);
        if (h.real) {
          await store.accounts.recordFailure(h.accountId, f.lockedUntil);
          if (f.lockedUntil !== null && f.count === 5) deps.onLocked?.(h.accountId);
        }
        return reject();
      }
      failures.succeed(h.subject);
      await store.accounts.clearFailures(h.accountId);
      sessions.authenticate(id, {
        accountId: h.accountId, deviceId: h.deviceId, authenticatedAt: clock.now(), m1: Uint8Array.from(M1),
        transport: createServerTransport({ sessionId, sessionKey: done.key, transcript: done.transcript, nowMs: () => clock.now() }),
      });
      done.key.fill(0);
      return { M2: done.M2 };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
