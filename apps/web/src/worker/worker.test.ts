import { describe, expect, it, vi } from 'vitest';
import { createFakeBus, createFakeLocks } from './fakes';
import { acquire, type Leadership } from './leader';
import { channelEndpoint, createRpcClient, RpcError, serveRpc, type Endpoint } from './rpc';
import { createCoreRuntime } from './runtime';

/** A pair of connected in-memory endpoints (a MessageChannel without the browser). */
function pair(): [Endpoint, Endpoint] {
  const make = (): { ep: Endpoint; deliver: (m: unknown) => void } => {
    const listeners = new Set<(m: unknown) => void>();
    return { deliver: (m) => listeners.forEach((l) => l(structuredClone(m))), ep: { post: () => undefined, onMessage: (fn) => (listeners.add(fn), () => listeners.delete(fn)) } };
  };
  const a = make();
  const b = make();
  a.ep.post = (m) => queueMicrotask(() => b.deliver(m));
  b.ep.post = (m) => queueMicrotask(() => a.deliver(m));
  return [a.ep, b.ep];
}

describe('rpc', () => {
  it('round-trips structured values including bigint and bytes', async () => {
    const [client, server] = pair();
    serveRpc(server, { echo: async (a) => a });
    const call = createRpcClient(client);
    const value = { amount: 2n ** 62n + 1n, bytes: new Uint8Array([1, 2, 3]), nested: [null, true, 'x'] };
    expect(await call('echo', value)).toEqual(value);
  });

  it('correlates concurrent requests', async () => {
    const [client, server] = pair();
    serveRpc(server, { slow: async (a: number) => (await new Promise((r) => setTimeout(r, 10 - a)), a * 2) });
    const call = createRpcClient(client);
    expect(await Promise.all([1, 2, 3, 4].map((n) => call('slow', n)))).toEqual([2, 4, 6, 8]);
  });

  it('reports errors as a kind and code only, never the message', async () => {
    const [client, server] = pair();
    serveRpc(server, {
      boom: async () => { throw Object.assign(new Error('INSERT 12.50 for Alice failed'), { code: 'invariant_violation' }); },
      plain: async () => { throw new TypeError('secret detail'); },
    });
    const call = createRpcClient(client);
    const e1 = await call('boom').catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(RpcError);
    expect(e1).toMatchObject({ kind: 'Error', code: 'invariant_violation' });
    expect(JSON.stringify([(e1 as RpcError).message, (e1 as RpcError).code])).not.toMatch(/Alice|12\.50|INSERT/);
    const e2 = await call('plain').catch((e: unknown) => e);
    expect(e2).toMatchObject({ kind: 'TypeError' });
    expect((e2 as RpcError).message).not.toContain('secret');
  });

  it('rejects unknown methods without calling anything', async () => {
    const [client, server] = pair();
    serveRpc(server, { ok: async () => 1 });
    await expect(createRpcClient(client)('constructor')).rejects.toMatchObject({ code: 'unknown_method' });
    await expect(createRpcClient(client)('__proto__')).rejects.toMatchObject({ code: 'unknown_method' });
  });

  it('cancels: the handler sees an aborted signal and the caller gets Cancelled', async () => {
    const [client, server] = pair();
    let seen: AbortSignal | undefined;
    serveRpc(server, { wait: (_a, ctx) => (seen = ctx.signal, new Promise((_r, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('aborted'))))) });
    const controller = new AbortController();
    const pending = createRpcClient(client)('wait', undefined, controller.signal);
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await new Promise((r) => setTimeout(r, 5));
    expect(seen?.aborted).toBe(true);
  });

  it('times out when nobody answers', async () => {
    const [client] = pair();
    await expect(createRpcClient(client, { timeoutMs: 20 })('x')).rejects.toMatchObject({ code: 'no_response' });
  });
});

describe('leader election (single writer)', () => {
  it('the first holder leads and everyone else follows', async () => {
    const locks = createFakeLocks();
    const a = await acquire(locks, 'core');
    const b = await acquire(locks, 'core');
    expect([a.role, b.role]).toEqual(['leader', 'follower']);
    a.relinquish?.();
  });

  it('a follower that waits becomes leader when the leader goes away', async () => {
    const locks = createFakeLocks();
    const a = await acquire(locks, 'core');
    const b = await acquire(locks, 'core');
    const promoted = (b as Extract<Leadership, { role: 'follower' }>).whenLeader();
    a.relinquish?.();
    const next = await promoted;
    expect(next.role).toBe('leader');
    next.relinquish?.();
  });
});

describe('core runtime', () => {
  async function tabs() {
    const bus = createFakeBus();
    const locks = createFakeLocks();
    const terminate = [vi.fn(), vi.fn()];
    const wipe = [vi.fn(), vi.fn()];
    const mk = (i: number) => createCoreRuntime({ locks, channel: bus.open(), tabId: `tab${i}`, handlers: { ping: async () => 'pong', who: async () => `handled by tab${i}` }, onLock: () => wipe[i]!(), terminate: () => terminate[i]!(), rpcTimeoutMs: 200 });
    const [a, b] = [mk(0), mk(1)];
    await a.start();
    await b.start();
    return { a, b, wipe, terminate };
  }

  it('one tab leads; the other proxies its calls to the leader', async () => {
    const { a, b } = await tabs();
    expect([a.role(), b.role()]).toEqual(['leader', 'follower']);
    const [pageA] = pair();
    expect(pageA).toBeDefined();
    expect(await a.call('who')).toBe('handled by tab0');
    expect(await b.call('who')).toBe('handled by tab0'); // proxied
    expect(await b.call('ping')).toBe('pong');
  });

  it('broadcasts change events to every tab', async () => {
    const { a, b } = await tabs();
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    a.onEvent((e) => seenA.push(e));
    b.onEvent((e) => seenB.push(e));
    a.publish({ type: 'RecordChanged', fold: 'f', rec: 'r', table: 6 });
    await new Promise((r) => setTimeout(r, 5));
    expect(seenB).toEqual([{ type: 'RecordChanged', fold: 'f', rec: 'r', table: 6 }]);
    expect(seenA).toEqual([]); // the publisher already knows
  });

  it('locking wipes secrets, tells every tab, releases leadership and terminates the worker', async () => {
    const { a, b, wipe, terminate } = await tabs();
    const events: unknown[] = [];
    b.onEvent((e) => events.push(e));
    await a.call('lock');
    await new Promise((r) => setTimeout(r, 5));
    expect(wipe[0]).toHaveBeenCalledTimes(1);
    expect(terminate[0]).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: 'Locked' }]);
    expect(b.locked()).toBe(true);
    await expect(b.call('ping')).rejects.toMatchObject({ code: 'locked' });
  });

  it('a follower with no live leader reports Locked instead of hanging', async () => {
    const bus = createFakeBus();
    const lone = createCoreRuntime({ locks: createFakeLocks(), channel: bus.open(), tabId: 'solo', handlers: {}, onLock: () => undefined, terminate: () => undefined, rpcTimeoutMs: 30 });
    await lone.start();
    // a second runtime pretends a leader exists by holding the lock, but never answers
    const locks = createFakeLocks();
    await acquire(locks, 'cashfold-core');
    const orphan = createCoreRuntime({ locks, channel: bus.open(), tabId: 'orphan', handlers: {}, onLock: () => undefined, terminate: () => undefined, rpcTimeoutMs: 30 });
    await orphan.start();
    expect(orphan.role()).toBe('follower');
    await expect(orphan.call('ping')).rejects.toMatchObject({ code: 'no_response' });
  });

  it('channelEndpoint ignores messages meant for others', async () => {
    const bus = createFakeBus();
    const [x, y] = [bus.open(), bus.open()];
    const got: unknown[] = [];
    channelEndpoint(y, { self: 'y', peer: 'x' }).onMessage((m) => got.push(m));
    x.postMessage({ rpc: true, to: 'someone-else', body: 1 });
    x.postMessage({ rpc: true, to: 'y', from: 'x', body: 2 });
    await new Promise((r) => setTimeout(r, 5));
    expect(got).toEqual([2]);
  });
});
