import type { ChannelLike } from './leader';

// Typed request/response over any message pipe. Values travel by structured clone, so bigint money and byte
// arrays survive. Errors cross as a kind and an optional code, never as message text (FR-098).

export interface Endpoint {
  post(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
}

export type Handler = (args: never, context: { signal: AbortSignal }) => Promise<unknown>;
export type Handlers = Readonly<Record<string, Handler>>;

export class RpcError extends Error {
  constructor(readonly kind: string, readonly code?: string) {
    super(code === undefined ? kind : `${kind}: ${code}`);
    this.name = 'RpcError';
  }
}

interface Request { rpc: 'req'; id: number; method: string; args: unknown }
interface Response { rpc: 'res'; id: number; ok: boolean; result?: unknown; error?: { kind: string; code?: string } }
interface Cancel { rpc: 'cancel'; id: number }

const isObject = (m: unknown): m is Record<string, unknown> => typeof m === 'object' && m !== null;

/** A write that failed because the device has no room left. Nothing was saved, and nothing already saved is touched. */
export const isStorageFull = (e: unknown): boolean => {
  const name = (e as { name?: unknown } | null)?.name;
  const message = String((e as { message?: unknown } | null)?.message ?? '');
  return name === 'QuotaExceededError' || (e as { resultCode?: unknown } | null)?.resultCode === 13 || /SQLITE_FULL|database or disk is full|quota/i.test(message);
};

function describe(e: unknown): { kind: string; code?: string } {
  if (isStorageFull(e)) return { kind: 'RpcError', code: 'storage_full' };
  if (e instanceof RpcError) return e.code === undefined ? { kind: e.kind } : { kind: e.kind, code: e.code };
  const code = (e as { code?: unknown } | null)?.code;
  const kind = e instanceof Error ? e.name : 'Error';
  return typeof code === 'string' ? { kind, code } : { kind };
}

export interface RpcServer {
  /** Runs one incoming message; `reply` receives the response. Cancel messages abort the matching request. */
  handle(message: unknown, reply: (response: unknown) => void, scope?: string): void;
  /** Calls a handler directly, as a local caller would. */
  invoke(method: string, args: unknown, signal?: AbortSignal): Promise<unknown>;
}

export function createRpcServer(handlers: Handlers): RpcServer {
  const running = new Map<string, AbortController>();
  const find = (method: string): Handler | undefined => (Object.hasOwn(handlers, method) ? handlers[method] : undefined);

  return {
    invoke(method, args, signal = new AbortController().signal) {
      const handler = find(method);
      if (handler === undefined) return Promise.reject(new RpcError('RpcError', 'unknown_method'));
      return (handler as (a: unknown, c: { signal: AbortSignal }) => Promise<unknown>)(args, { signal });
    },

    handle(message, reply, scope = '') {
      if (!isObject(message)) return;
      if (message['rpc'] === 'cancel') {
        running.get(`${scope}:${String(message['id'])}`)?.abort();
        return;
      }
      if (message['rpc'] !== 'req') return;
      const { id, method, args } = message as unknown as Request;
      const key = `${scope}:${id}`;
      const controller = new AbortController();
      running.set(key, controller);
      this.invoke(method, args, controller.signal).then(
        (result) => reply({ rpc: 'res', id, ok: true, result } satisfies Response),
        (e: unknown) => reply({ rpc: 'res', id, ok: false, error: describe(e) } satisfies Response),
      ).finally(() => running.delete(key));
    },
  };
}

export function serveRpc(endpoint: Endpoint, handlers: Handlers): () => void {
  const server = createRpcServer(handlers);
  return endpoint.onMessage((m) => server.handle(m, (r) => endpoint.post(r)));
}

export function createRpcClient(endpoint: Endpoint, options: { timeoutMs?: number } = {}) {
  let next = 1;
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: unknown) => void }>();
  endpoint.onMessage((m) => {
    if (!isObject(m) || m['rpc'] !== 'res') return;
    const { id, ok, result, error } = m as unknown as Response;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(result as never);
    else p.reject(new RpcError(error?.kind ?? 'Error', error?.code));
  });

  return function call<R = unknown>(method: string, args?: unknown, signal?: AbortSignal): Promise<R> {
    const id = next++;
    return new Promise<R>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        pending.delete(id);
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        done();
        endpoint.post({ rpc: 'cancel', id } satisfies Cancel);
        reject(new RpcError('RpcError', 'cancelled'));
      };
      pending.set(id, {
        resolve: (v) => (done(), resolve(v as R)),
        reject: (e) => (done(), reject(e)),
      });
      if (options.timeoutMs !== undefined) timer = setTimeout(() => (done(), reject(new RpcError('RpcError', 'no_response'))), options.timeoutMs);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      endpoint.post({ rpc: 'req', id, method, args } satisfies Request);
    });
  };
}

/** An endpoint over a BroadcastChannel, addressed by tab id. Messages for other tabs are ignored. */
export function channelEndpoint(channel: ChannelLike, { self, peer }: { self: string; peer: string }): Endpoint {
  return {
    post: (body) => channel.postMessage({ rpc: true, from: self, to: peer, body }),
    onMessage(listener) {
      const wrapped = (e: { data: unknown }) => {
        const d = e.data;
        if (isObject(d) && d['rpc'] === true && d['to'] === self) listener(d['body']);
      };
      channel.addEventListener('message', wrapped);
      return () => channel.removeEventListener('message', wrapped);
    },
  };
}
