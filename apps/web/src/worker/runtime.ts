import { acquire, type ChannelLike, type Leadership, type LocksLike } from './leader';
import { channelEndpoint, createRpcClient, createRpcServer, RpcError, type Handlers, type RpcServer } from './rpc';

// The Core Worker's coordination layer. One tab's worker leads and owns the database; the others proxy their
// calls to it over a BroadcastChannel and hear the same change events. Locking in any tab locks them all.

export const LOCK_NAME = 'cashfold-core';
const LEADER = 'leader';

export type CoreEvent = { readonly type: string; readonly [key: string]: unknown };

export interface RuntimeOptions {
  readonly locks: LocksLike;
  readonly channel: ChannelLike;
  readonly tabId: string;
  readonly handlers: Handlers;
  /** Wipes keys and closes the database. Runs in the leader. */
  readonly onLock: () => void | Promise<void>;
  /** Ends this worker, discarding its heap. */
  readonly terminate: () => void;
  readonly rpcTimeoutMs?: number;
}

export interface CoreRuntime {
  start(): Promise<void>;
  role(): 'leader' | 'follower' | 'starting';
  locked(): boolean;
  call<R = unknown>(method: string, args?: unknown, signal?: AbortSignal): Promise<R>;
  publish(event: CoreEvent): void;
  onEvent(listener: (event: CoreEvent) => void): () => void;
}

export function createCoreRuntime(options: RuntimeOptions): CoreRuntime {
  const { locks, channel, tabId } = options;
  const listeners = new Set<(event: CoreEvent) => void>();
  let leadership: Leadership | undefined;
  let server: RpcServer | undefined;
  let isLocked = false;

  const publish = (event: CoreEvent) => channel.postMessage({ event: true, body: event });

  channel.addEventListener('message', (e) => {
    const d = e.data as { event?: boolean; body?: CoreEvent } | null;
    if (d?.event === true && d.body) {
      if (d.body.type === 'Locked') isLocked = true;
      listeners.forEach((l) => l(d.body!));
    }
  });

  const proxy = createRpcClient(channelEndpoint(channel, { self: tabId, peer: LEADER }), options.rpcTimeoutMs === undefined ? {} : { timeoutMs: options.rpcTimeoutMs });

  function becomeLeader(): void {
    const handlers: Handlers = {
      ...options.handlers,
      lock: async () => {
        await options.onLock();
        isLocked = true;
        publish({ type: 'Locked' });
        leadership?.relinquish?.();
        options.terminate();
        return true;
      },
    };
    server = createRpcServer(handlers);
    // Serve other tabs: requests addressed to "leader", answered to the asking tab.
    channel.addEventListener('message', (e) => {
      const d = e.data as { rpc?: boolean; to?: string; from?: string; body?: unknown } | null;
      if (d?.rpc !== true || d.to !== LEADER || typeof d.from !== 'string') return;
      const from = d.from;
      server?.handle(d.body, (response) => channel.postMessage({ rpc: true, from: LEADER, to: from, body: response }), from);
    });
  }

  return {
    async start() {
      leadership = await acquire(locks, LOCK_NAME);
      if (leadership.role === 'leader') becomeLeader();
    },
    role: () => leadership?.role ?? 'starting',
    locked: () => isLocked,
    async call<R>(method: string, args?: unknown, signal?: AbortSignal): Promise<R> {
      if (isLocked) throw new RpcError('RpcError', 'locked');
      if (leadership?.role === 'leader' && server) return (await server.invoke(method, args, signal)) as R;
      return proxy<R>(method, args, signal);
    },
    publish,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
