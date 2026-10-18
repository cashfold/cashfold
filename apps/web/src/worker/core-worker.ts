/// <reference lib="webworker" />
import { createAccountCrypto } from '../adapters/account-crypto';
import { createIdbCredentialStore } from '../adapters/keystore-idb/credential-store';
import { loadRuntime } from '../adapters/sqlite-opfs/runtime';
import { createAppHandlers } from './app-handlers';
import { serveRpc, type Endpoint } from './rpc';
import { createCoreRuntime, type CoreRuntime } from './runtime';

// Dedicated worker entry. The page talks to it over postMessage; the worker coordinates with other tabs' workers.
// Keys and the database live only here (Constitution VIII). When the app locks, this worker ends and takes them with it.

declare const self: DedicatedWorkerGlobalScope;

const rng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };

const pageEndpoint: Endpoint = {
  post: (m) => self.postMessage(m),
  onMessage(listener) {
    const wrapped = (e: MessageEvent) => listener(e.data);
    self.addEventListener('message', wrapped);
    return () => self.removeEventListener('message', wrapped);
  },
};

let core: CoreRuntime | undefined;

const app = createAppHandlers({
  runtime: () => loadRuntime(),
  rng,
  credentials: createIdbCredentialStore(),
  accountCrypto: createAccountCrypto({ rng }),
  nowMs: Date.now,
  // The session locked itself (idle timeout, hidden too long, page going away): tell every tab, then end.
  onLocked: () => {
    core?.publish({ type: 'Locked' });
    self.postMessage({ rpc: 'event', event: { type: 'Locked' } });
    self.close();
  },
});

core = createCoreRuntime({
  locks: navigator.locks as never,
  channel: new BroadcastChannel('cashfold-core'),
  tabId: crypto.randomUUID(),
  handlers: app.handlers,
  onLock: () => app.session.lock(),
  terminate: () => self.close(),
  rpcTimeoutMs: 30_000,
});

await core.start();
core.onEvent((event) => self.postMessage({ rpc: 'event', event }));
setInterval(() => app.session.tick(), 5_000);

// Page -> worker: one pass-through method, so every call (leader or follower) takes the same path.
serveRpc(pageEndpoint, {
  invoke: ((args: { method: string; args?: unknown }, ctx: { signal: AbortSignal }) => core!.call(args.method, args.args, ctx.signal)) as never,
  role: (async () => core!.role()) as never,
});
