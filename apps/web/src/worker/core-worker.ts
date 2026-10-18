/// <reference lib="webworker" />
import { createAccountCrypto } from '../adapters/account-crypto';
import { createIdbCredentialStore } from '../adapters/keystore-idb/credential-store';
import { createIdbDeviceSettings } from '../adapters/keystore-idb/device-settings';
import { createIdbQuickUnlockStore } from '../adapters/keystore-idb/quick-unlock-store';
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

// onLocked fires from inside handlers that are created before the runtime exists, so it reaches it through this holder.
const holder: { core?: CoreRuntime } = {};

const accountCrypto = createAccountCrypto({ rng });

const app = createAppHandlers({
  runtime: () => loadRuntime(),
  rng,
  credentials: createIdbCredentialStore(),
  settings: createIdbDeviceSettings(),
  accountCrypto,
  quickStore: createIdbQuickUnlockStore(),
  quickCrypto: { enroll: (a) => accountCrypto.enrollQuick(a), unlock: (a) => accountCrypto.unlockQuick(a) },
  nowMs: Date.now,
  // The session locked itself (idle timeout, hidden too long, page going away): tell every tab, then end.
  onLocked: () => {
    holder.core?.publish({ type: 'Locked' });
    self.postMessage({ rpc: 'event', event: { type: 'Locked' } });
    self.close();
  },
});

const core = (holder.core = createCoreRuntime({
  locks: navigator.locks as never,
  channel: new BroadcastChannel('cashfold-core'),
  tabId: crypto.randomUUID(),
  handlers: app.handlers,
  onLock: () => app.session.lock(),
  terminate: () => self.close(),
  rpcTimeoutMs: 30_000,
}));

// Register the page-facing server before anything is awaited: the page sends its first message as soon as the worker exists,
// and a message that arrives before a listener is attached is lost. Calls simply wait until the runtime is ready.
const ready = core.start();
void ready.then(() => core.onEvent((event) => self.postMessage({ rpc: 'event', event })));
setInterval(() => app.session.tick(), 5_000);

// Page -> worker: one pass-through method, so every call (leader or follower) takes the same path.
serveRpc(pageEndpoint, {
  invoke: (async (args: { method: string; args?: unknown }, ctx: { signal: AbortSignal }) => {
    await ready;
    return core.call(args.method, args.args, ctx.signal);
  }) as never,
  role: (async () => (await ready, core.role())) as never,
});
