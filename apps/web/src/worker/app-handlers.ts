import {
  createAccount, createFoldCommands, createSession, describeFoldDeletion, DEFAULT_LOCK_POLICY, newIdV4, unlock,
  type AccountCryptoPort, type CredentialStorePort, type Id, type LockPolicy, type Session, type UnlockCryptoPort,
} from '@cashfold/core';
import { SecretBuf } from '@cashfold/crypto';
import { createWebSession } from '../adapters/sqlite-opfs/web-session';
import type { SqliteRuntime } from '../adapters/sqlite-opfs/runtime';
import { RpcError, type Handlers } from './rpc';

// The Core Worker's application surface (contracts/core-api.md). Everything crossing the RPC boundary is plain data:
// passwords arrive as bytes so the page can wipe its copy, and results are `{ ok, value | error }` objects.
// Nothing secret ever goes back to the page except the Secret Key, once, at sign-up.

export interface AppHandlerDeps {
  readonly runtime: () => Promise<SqliteRuntime>;
  readonly rng: { bytes(n: number): Uint8Array };
  readonly credentials: CredentialStorePort;
  readonly accountCrypto: AccountCryptoPort & UnlockCryptoPort;
  readonly nowMs: () => number;
  /** Called after the session locks itself (idle, hidden, page gone): announce and end the worker. */
  readonly onLocked: () => void;
  readonly lockPolicy?: LockPolicy;
}

export type Phase = 'no_account' | 'locked' | 'unlocked';

export interface AppRuntime {
  readonly handlers: Handlers;
  readonly session: Session;
}

const secretFrom = (bytes: unknown): SecretBuf => {
  if (!(bytes instanceof Uint8Array)) throw new RpcError('TypeError', 'bad_argument');
  const secret = SecretBuf.from(bytes);
  bytes.fill(0); // the copy that crossed the boundary is not needed any more
  return secret;
};

export function createAppHandlers(deps: AppHandlerDeps): AppRuntime {
  let webSession: ReturnType<typeof createWebSession> | undefined;
  const session = createSession({
    closeDatabase: async () => void (await webSession?.stop()),
    terminateWorker: deps.onLocked,
    policy: deps.lockPolicy ?? DEFAULT_LOCK_POLICY,
    nowMs: deps.nowMs,
  });

  async function newWebSession() {
    webSession = createWebSession({ runtime: await deps.runtime(), rng: deps.rng, nowMs: deps.nowMs, isUnlocked: () => session.state() === 'unlocked' });
    return webSession;
  }

  const open = () => {
    const current = webSession?.current();
    if (current === undefined || session.state() !== 'unlocked') throw new RpcError('RpcError', 'locked');
    session.activity();
    return current;
  };

  const handlers: Handlers = {
    async status() {
      const stored = await deps.credentials.load();
      const phase: Phase = stored === undefined ? 'no_account' : webSession?.current() !== undefined && session.state() === 'unlocked' ? 'unlocked' : 'locked';
      return stored === undefined
        ? { phase }
        : { phase, email: stored.email, accountId: stored.accountId, server: stored.server, registration: stored.registration };
    },

    async createAccount(args: { email: string; password: Uint8Array; server: string; discoverable: boolean; foldName?: string; baseCurrency?: string }) {
      const sessionPort = await newWebSession();
      const input = { email: args.email, password: secretFrom(args.password), server: args.server, discoverable: args.discoverable, ...(args.foldName === undefined ? {} : { foldName: args.foldName }), ...(args.baseCurrency === undefined ? {} : { baseCurrency: args.baseCurrency }) };
      const result = await createAccount({ crypto: deps.accountCrypto, registration: { register: async () => ({ ok: false, reason: 'offline' }) }, credentials: deps.credentials, sessionPort, session, random: deps.rng })(input);
      return result.ok ? { ok: true, value: { secretKeyText: result.value.secretKeyText, accountId: result.value.accountId, fold: result.value.fold, registration: result.value.registration } } : result;
    },

    async unlock(args: { password: Uint8Array }) {
      const sessionPort = await newWebSession();
      const result = await unlock({ unlockCrypto: deps.accountCrypto, credentials: deps.credentials, sessionPort, session })({ password: secretFrom(args.password) });
      return result.ok ? { ok: true, value: { accountId: result.value.accountId, email: result.value.email, server: result.value.server } } : result;
    },

    async 'session.activity'() {
      session.activity();
      return true;
    },
    async 'session.visibility'(args: { state: 'visible' | 'hidden' }) {
      session.visibility(args.state);
      return session.covered();
    },
    async 'session.focus'(args: { focused: boolean }) {
      session.focus(args.focused);
      return session.covered();
    },
    async 'session.pageHide'() {
      session.pageHide();
      return true;
    },
    async 'session.tick'() {
      session.tick();
      return session.state();
    },

    async 'folds.list'() {
      return [...(await open().directory.list())];
    },

    async 'folds.create'(args: { name: string; baseCurrency: string }) {
      const s = open();
      const commands = createFoldCommands({ directory: s.directory, foldKeys: s.keyring });
      return s.commandBus.execute(commands.createFold, { fold: newIdV4((n) => deps.rng.bytes(n)), name: args.name, baseCurrency: args.baseCurrency });
    },

    async 'folds.rename'(args: { fold: Id; name: string }) {
      const s = open();
      return s.commandBus.execute(createFoldCommands({ directory: s.directory, foldKeys: s.keyring }).renameFold, args);
    },

    async 'folds.describeDeletion'(args: { fold: Id }) {
      return (await describeFoldDeletion(open().directory, args.fold)) ?? null;
    },

    async 'folds.delete'(args: { fold: Id; confirmName: string }) {
      const s = open();
      return s.commandBus.execute(createFoldCommands({ directory: s.directory, foldKeys: s.keyring }).deleteFold, args);
    },
  };

  return { handlers, session };
}
