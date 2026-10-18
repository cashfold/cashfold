/// <reference lib="webworker" />
import { createCoreRuntime } from './runtime';
import { serveRpc, type Endpoint } from './rpc';

// Dedicated worker entry. The page talks to it over postMessage; the worker coordinates with other tabs' workers.
// Keys and the database live only here (Constitution VIII). Application handlers are registered by each user story.

declare const self: DedicatedWorkerGlobalScope;

const pageEndpoint: Endpoint = {
  post: (m) => self.postMessage(m),
  onMessage(listener) {
    const wrapped = (e: MessageEvent) => listener(e.data);
    self.addEventListener('message', wrapped);
    return () => self.removeEventListener('message', wrapped);
  },
};

const runtime = createCoreRuntime({
  locks: navigator.locks as never,
  channel: new BroadcastChannel('cashfold-core'),
  tabId: crypto.randomUUID(),
  handlers: {
    ping: async () => 'pong',
    status: async () => ({ locked: false }),
  },
  onLock: () => {
    // Identity wires this to: wipe every SecretBuf, close the database.
  },
  terminate: () => self.close(),
  rpcTimeoutMs: 5000,
});

await runtime.start();
runtime.onEvent((event) => self.postMessage({ rpc: 'event', event }));

// Page -> worker: one pass-through method, so every call (leader or follower) takes the same path.
serveRpc(pageEndpoint, {
  invoke: ((args: { method: string; args?: unknown }, ctx: { signal: AbortSignal }) => runtime.call(args.method, args.args, ctx.signal)) as never,
  role: (async () => runtime.role()) as never,
});
