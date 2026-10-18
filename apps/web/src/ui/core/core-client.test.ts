import { describe, expect, it } from 'vitest';
import { createCoreClient, type WorkerLike } from './core-client';
import { serveRpc, type Endpoint } from '../../worker/rpc';

/** A worker whose other end serves RPC; `emit` sends an event message from the "worker". */
function fakeWorker(handlers: Parameters<typeof serveRpc>[1]) {
  const listeners = new Set<(e: { data: unknown }) => void>();
  let terminated = false;
  const toWorker = new Set<(m: unknown) => void>();
  const workerSide: Endpoint = {
    post: (m) => queueMicrotask(() => listeners.forEach((l) => l({ data: structuredClone(m) }))),
    onMessage: (fn) => (toWorker.add(fn), () => toWorker.delete(fn)),
  };
  serveRpc(workerSide, handlers);
  const worker: WorkerLike = {
    postMessage: (m) => queueMicrotask(() => toWorker.forEach((l) => l(structuredClone(m)))),
    addEventListener: (_t, fn) => void listeners.add(fn),
    removeEventListener: (_t, fn) => void listeners.delete(fn),
    terminate: () => void (terminated = true),
  };
  return { worker, isTerminated: () => terminated, emit: (event: unknown) => queueMicrotask(() => listeners.forEach((l) => l({ data: { rpc: 'event', event } }))) };
}

const passthrough = { invoke: (async (a: { method: string; args?: unknown }) => `${a.method}:${JSON.stringify(a.args ?? null)}`) as never };

describe('core client', () => {
  it('starts the worker on first use, not before', async () => {
    let spawned = 0;
    const client = createCoreClient(() => (spawned++, fakeWorker(passthrough).worker));
    expect(spawned).toBe(0);
    expect(await client.call('status')).toBe('status:null');
    expect(await client.call('folds.rename', { a: 1 })).toBe('folds.rename:{"a":1}');
    expect(spawned).toBe(1);
  });

  it('forwards worker events to subscribers', async () => {
    const f = fakeWorker(passthrough);
    const client = createCoreClient(() => f.worker);
    const seen: unknown[] = [];
    client.onEvent((e) => seen.push(e));
    await client.call('status');
    f.emit({ type: 'RecordChanged', rec: 'x' });
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([{ type: 'RecordChanged', rec: 'x' }]);
  });

  it('on a Locked event it ends the worker, tells subscribers, and starts a fresh worker for the next call', async () => {
    const made: ReturnType<typeof fakeWorker>[] = [];
    const client = createCoreClient(() => { const f = fakeWorker(passthrough); made.push(f); return f.worker; });
    const seen: unknown[] = [];
    client.onEvent((e) => seen.push(e));
    await client.call('status');
    made[0]!.emit({ type: 'Locked' });
    await new Promise((r) => setTimeout(r, 5));
    expect(made[0]!.isTerminated()).toBe(true);
    expect(seen).toEqual([{ type: 'Locked' }]);
    await client.call('status');
    expect(made).toHaveLength(2);
  });

  it('surfaces handler errors as kind and code only', async () => {
    const client = createCoreClient(() => fakeWorker({ invoke: (async () => { throw Object.assign(new Error('INSERT secret'), { code: 'locked' }); }) as never }).worker);
    const e = await client.call('x').catch((err: unknown) => err);
    expect(e).toMatchObject({ kind: 'Error', code: 'locked' });
    expect(String((e as Error).message)).not.toContain('secret');
  });

  it('treats a worker that stops answering as gone and replaces it', async () => {
    let n = 0;
    const silent: WorkerLike = { postMessage: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, terminate: () => undefined };
    const client = createCoreClient(() => (++n === 1 ? silent : fakeWorker(passthrough).worker), { timeoutMs: 20 });
    await expect(client.call('status')).rejects.toMatchObject({ code: 'no_response' });
    expect(await client.call('status')).toBe('status:null');
  });

  it('dispose terminates the worker', async () => {
    const f = fakeWorker(passthrough);
    const client = createCoreClient(() => f.worker);
    await client.call('status');
    client.dispose();
    expect(f.isTerminated()).toBe(true);
  });
});
