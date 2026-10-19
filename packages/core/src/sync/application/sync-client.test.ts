import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { createMemoryCursors, createReplica, createWorld, id, MemoryRelay, setup, type Node } from '../../testing/index';
import type { FieldValue } from '../domain/merge';
import type { PullResult, PushOutcome, SealedOp, TransportPort } from '../ports/index';
import { createSyncClient } from './sync-client';

const FOLD = id(0xf0);
const draft = (rec: number, n: number) => ({ fold: FOLD, rec: id(rec), table: 6, fields: new Map<number, FieldValue>([[1, `v${n}`], [2, BigInt(n)]]), sets: new Map() });

const records = async (n: Node) => [...(await n.replica.projections.listRecords(FOLD))].map(([rec, r]) => [rec, [...r.fields].map(([f, v]) => [f, v.value]).sort()]).sort();

describe('sync client: push and pull', () => {
  it('delivers one device\'s edits to another and marks them pushed', async () => {
    const { node, relay } = await setup();
    const [a, b] = [await node(0), await node(1)];
    for (let i = 1; i <= 3; i++) await a.replica.writePath.submit(draft(i, i));
    const pushed = await a.client.syncFold(FOLD);
    expect(pushed).toMatchObject({ pushed: 3 });
    expect(pushed.failure).toBeUndefined();
    expect(await a.replica.oplog.listPending(FOLD)).toHaveLength(0);
    expect(relay.size(FOLD)).toBe(3);

    const pulled = await b.client.syncFold(FOLD);
    expect(pulled).toMatchObject({ applied: 3, quarantined: 0, head: 3n });
    expect(await records(b)).toEqual(await records(a));
  });

  it('is idempotent: syncing again changes nothing and sends nothing', async () => {
    const { node, relay } = await setup();
    const [a, b] = [await node(0), await node(1)];
    await a.replica.writePath.submit(draft(1, 1));
    expect(await a.client.syncFold(FOLD)).toMatchObject({ pushed: 1, duplicates: 1 }); // the echo of its own op
    await b.client.syncFold(FOLD);
    const again = await b.client.syncFold(FOLD);
    expect(again).toMatchObject({ pushed: 0, applied: 0, pulled: 0 });
    expect(await a.client.syncFold(FOLD)).toMatchObject({ pushed: 0, applied: 0, pulled: 0 }); // a's own op was seen as an echo the first time
    expect(relay.size(FOLD)).toBe(1);
  });

  it('converges two devices that edited offline, in either sync order', async () => {
    const { node } = await setup();
    const [a, b] = [await node(0), await node(1)];
    await a.replica.writePath.submit(draft(1, 1));
    await b.replica.writePath.submit({ ...draft(1, 2), fields: new Map<number, FieldValue>([[2, 99n], [3, 'b-note']]) });
    await a.client.syncFold(FOLD);
    await b.client.syncFold(FOLD);
    await a.client.syncFold(FOLD);
    expect(await records(a)).toEqual(await records(b));
  });

  it('pulls in pages until it reaches the head', async () => {
    const { node } = await setup();
    const small = (relay: MemoryRelay): TransportPort => ({ push: async (f, o) => relay.push(f, o), pull: async (f, after, limit) => relay.pull(f, after, Math.min(limit, 2)) });
    const w = await setup(small);
    const [a, b] = [await w.node(0), await w.node(1)];
    void node;
    for (let i = 1; i <= 7; i++) await a.replica.writePath.submit(draft(i, i));
    await a.client.syncFold(FOLD);
    expect(await b.client.syncFold(FOLD)).toMatchObject({ applied: 7, head: 7n });
  });

  it('resumes after an interruption without duplicating or losing anything', async () => {
    const w = await setup();
    let failPulls = 1;
    let failPushes = 1;
    const flaky = (relay: MemoryRelay): TransportPort => ({
      push: async (f, o) => {
        if (failPushes-- > 0) throw Object.assign(new Error('network'), { kind: 'offline' });
        return relay.push(f, o);
      },
      pull: async (f, after, limit) => {
        if (failPulls-- > 0) throw Object.assign(new Error('network'), { kind: 'offline' });
        return relay.pull(f, after, limit);
      },
    });
    const a = await w.node(0, flaky(w.relay));
    const b = await w.node(1, flaky(w.relay));
    for (let i = 1; i <= 3; i++) await a.replica.writePath.submit(draft(i, i));
    expect(await a.client.syncFold(FOLD)).toMatchObject({ failure: 'offline', pushed: 0 });
    expect(await a.replica.oplog.listPending(FOLD)).toHaveLength(3);
    expect(await a.client.syncFold(FOLD)).toMatchObject({ pushed: 3 });
    expect(await b.client.syncFold(FOLD)).toMatchObject({ applied: 3 }); // failPulls spent on a's pull above
    expect(w.relay.size(FOLD)).toBe(3);
  });

  it('keeps an op the relay refuses pending and reports it', async () => {
    const w = await setup();
    const refusing = (relay: MemoryRelay): TransportPort => ({
      push: async (_f, ops: readonly SealedOp[]): Promise<PushOutcome[]> => ops.map((o, i) => (i === 0 ? { op: o.op, error: 'unknown_epoch' } : { op: o.op })),
      pull: async (f, after, limit): Promise<PullResult> => relay.pull(f, after, limit),
    });
    const a = await w.node(0, refusing(w.relay));
    await a.replica.writePath.submit(draft(1, 1));
    await a.replica.writePath.submit(draft(2, 2));
    const r = await a.client.syncFold(FOLD);
    expect(r).toMatchObject({ failure: 'rejected', pushed: 0 });
    expect(r.rejectedOps).toHaveLength(1);
    expect(r.rejectedOps[0]!.reason).toBe('unknown_epoch');
    expect(await a.replica.oplog.listPending(FOLD)).toHaveLength(2); // order matters: nothing after the refused op is sent
  });

  it('splits a large push into batches of at most 256 ops', async () => {
    const w = await setup();
    const sizes: number[] = [];
    const spy = (relay: MemoryRelay): TransportPort => ({ push: async (f, o) => (sizes.push(o.length), relay.push(f, o)), pull: async (f, a, l) => relay.pull(f, a, l) });
    const a = await w.node(0, spy(w.relay));
    await a.replica.writePath.submitMany(Array.from({ length: 300 }, (_, i) => draft((i % 20) + 1, i)));
    expect(await a.client.syncFold(FOLD)).toMatchObject({ pushed: 300 });
    expect(sizes).toEqual([256, 44]);
  });

  it('persists the pull cursor so a restart does not refetch', async () => {
    const w = await setup();
    const a = await w.node(0);
    await a.replica.writePath.submit(draft(1, 1));
    await a.client.syncFold(FOLD);
    const fresh = await w.world; void fresh;
    const seen: bigint[] = [];
    const watching = (relay: MemoryRelay): TransportPort => ({ push: async (f, o) => relay.push(f, o), pull: async (f, after, l) => (seen.push(after), relay.pull(f, after, l)) });
    const cursors = createMemoryCursors();
    const b = await createReplica(w.world, { device: id(0xd9) });
    const client = createSyncClient({ oplog: b.oplog, writePath: b.writePath, transport: watching(w.relay), cursors, clock: { nowMs: () => 1 } });
    await client.syncFold(FOLD);
    await client.syncFold(FOLD);
    expect(seen).toEqual([0n, 1n]);
  });

  it('reports the unknown-Fold case as ignored, not stored', async () => {
    const w = await setup();
    const a = await w.node(0);
    const other: Id = id(0xee);
    w.world.addFold(other);
    const outsider = await createReplica(await createWorld(), { device: id(0xd5) });
    const client = createSyncClient({ oplog: outsider.oplog, writePath: outsider.writePath, transport: w.relay.transport(), cursors: createMemoryCursors(), clock: { nowMs: () => 1 } });
    await a.replica.writePath.submit(draft(1, 1));
    await a.client.syncFold(FOLD);
    expect(await client.syncFold(FOLD)).toMatchObject({ ignored: 1, applied: 0 });
    expect(await outsider.oplog.list(FOLD)).toHaveLength(0);
  });
});
