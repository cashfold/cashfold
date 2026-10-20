import { createRpcClient, RpcError, type Endpoint } from '../../worker/rpc';

// The page's handle on the Core Worker. The worker starts on first use. When it locks (or stops answering) it is
// discarded, and the next call starts a fresh one: a locked app has no worker, so no secret survives in memory.

export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  terminate(): void;
}

export type CoreEvent = { readonly type: string; readonly [key: string]: unknown };

export interface CoreClient {
  call<R = unknown>(method: string, args?: unknown, signal?: AbortSignal): Promise<R>;
  /** Fire-and-forget: errors are ignored. For activity pings. */
  notify(method: string, args?: unknown): void;
  onEvent(listener: (event: CoreEvent) => void): () => void;
  dispose(): void;
}

export function createCoreClient(spawn: () => WorkerLike, options: { timeoutMs?: number } = {}): CoreClient {
  const listeners = new Set<(event: CoreEvent) => void>();
  let current: { worker: WorkerLike; call: ReturnType<typeof createRpcClient> } | undefined;

  function discard(): void {
    current?.worker.terminate();
    current = undefined;
  }

  function ensure() {
    if (current !== undefined) return current;
    const worker = spawn();
    const endpoint: Endpoint = {
      post: (m) => worker.postMessage(m),
      onMessage(listener) {
        const wrapped = (e: { data: unknown }) => listener(e.data);
        worker.addEventListener('message', wrapped);
        return () => worker.removeEventListener('message', wrapped);
      },
    };
    worker.addEventListener('message', (e) => {
      const d = e.data as { rpc?: string; event?: CoreEvent } | null;
      if (d?.rpc !== 'event' || d.event === undefined) return;
      if (d.event.type === 'Locked') discard();
      listeners.forEach((l) => l(d.event!));
    });
    current = { worker, call: createRpcClient(endpoint, options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) };
    return current;
  }

  return {
    async call<R>(method: string, args?: unknown, signal?: AbortSignal): Promise<R> {
      const worker = ensure();
      try {
        return await worker.call<R>('invoke', { method, args }, signal);
      } catch (e) {
        if (e instanceof RpcError && e.code === 'no_response') discard();
        throw e;
      }
    },
    notify(method, args) {
      void this.call(method, args).catch(() => undefined);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      discard();
      listeners.clear();
    },
  };
}
