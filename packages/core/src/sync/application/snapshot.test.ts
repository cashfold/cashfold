import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { id, setup, snapshotCodec, type Node } from '../../testing/index';
import type { FieldValue } from '../domain/merge';
import { createSnapshotService, type RelaySnapshot, type SnapshotService, type SnapshotTransportPort } from './snapshot';

const FOLD = id(0xf0);
const draft = (rec: number, n: number) => ({ fold: FOLD, rec: id(rec), table: 6, fields: new Map<number, FieldValue>([[1, `v${n}`], [2, BigInt(n)]]), sets: new Map() });
const state = async (n: Node) => JSON.stringify([...(await n.replica.projections.listRecords(FOLD))].map(([k, r]) => [k, [...r.fields].map(([f, e]) => [f, String(e.value)]).sort()]).sort());

async function world() {
  const w = await setup();
  const service = (n: Node, transport?: SnapshotTransportPort, signerAllowed?: (fold: Id, device: Id) => Promise<boolean>): SnapshotService =>
    createSnapshotService({
      ...(signerAllowed && { signerAllowed }),
      codec: snapshotCodec, oplog: n.replica.oplog, projections: n.replica.projections, cursors: n.cursors, sealer: n.replica.snapshots,
      keys: { deviceId: () => n.replica.device, currentEpoch: async () => 1 }, transport: transport ?? w.relay.snapshotTransport(n.replica.device),
    });
  return { ...w, service };
}

describe('snapshot service', () => {
  it('starts a new device from the snapshot, then keeps it in step with the log', async () => {
    const w = await world();
    const [a, b] = [await w.node(0), await w.node(1)];
    for (let i = 1; i <= 5; i++) await a.replica.writePath.submit(draft(i, i));
    await a.client.syncFold(FOLD);
    expect(await w.service(a).publish(FOLD)).toBe('published');

    expect(await w.service(b).bootstrap(FOLD)).toBe('installed');
    expect(await state(b)).toBe(await state(a));
    expect(await b.cursors.get(FOLD)).toEqual({ serverSeq: 5n, fromSnapshot: true });
    expect(await b.replica.oplog.list(FOLD)).toHaveLength(0);

    await a.replica.writePath.submit(draft(6, 6));
    await a.replica.writePath.submit({ ...draft(1, 9), fields: new Map<number, FieldValue>([[2, 99n]]) });
    await a.client.syncFold(FOLD);
    const report = await b.client.syncFold(FOLD);
    expect(report).toMatchObject({ applied: 2, pulled: 2 });
    expect(report.failure).toBeUndefined();
    expect(await state(b)).toBe(await state(a));
  });

  it('ignores a snapshot whose signer may not make one, and installs it when the signer is allowed', async () => {
    const w = await world();
    const [a, b] = [await w.node(0), await w.node(1)];
    for (let i = 1; i <= 3; i++) await a.replica.writePath.submit(draft(i, i));
    await a.client.syncFold(FOLD);
    expect(await w.service(a).publish(FOLD)).toBe('published');

    const asked: Array<[string, string]> = [];
    expect(await w.service(b, undefined, async (fold, device) => (asked.push([fold, device]), false)).bootstrap(FOLD)).toBe('refused');
    expect(asked).toEqual([[FOLD, a.replica.device]]);
    expect(await b.replica.projections.listRecords(FOLD)).toHaveLength(0);
    expect(await b.cursors.get(FOLD)).toMatchObject({ serverSeq: 0n });

    expect(await w.service(b, undefined, async () => true).bootstrap(FOLD)).toBe('installed');
    expect(await state(b)).toBe(await state(a));
  });

  it('will not publish while this device has work the relay has not seen, or before it has synced', async () => {
    const w = await world();
    const a = await w.node(0);
    expect(await w.service(a).publish(FOLD)).toBe('not_ready');
    await a.replica.writePath.submit(draft(1, 1));
    expect(await w.service(a).publish(FOLD)).toBe('not_ready');
    await a.client.syncFold(FOLD);
    expect(await w.service(a).publish(FOLD)).toBe('published');
  });

  it('ignores a snapshot that was altered, re-signed by a stranger, or moved to another position', async () => {
    const w = await world();
    const [a, b] = [await w.node(0), await w.node(1)];
    for (let i = 1; i <= 3; i++) await a.replica.writePath.submit(draft(i, i));
    await a.client.syncFold(FOLD);
    await w.service(a).publish(FOLD);
    const honest = w.relay.snapshotTransport(a.replica.device);
    const original = (await honest.get(FOLD))!;
    const through = (change: (s: RelaySnapshot) => RelaySnapshot): SnapshotTransportPort => ({ ...honest, get: async () => change(original) });

    const flipped = Uint8Array.from(original.blob);
    flipped[flipped.length - 2] = flipped.at(-2)! ^ 1;
    expect(await w.service(b, through((s) => ({ ...s, blob: flipped }))).bootstrap(FOLD)).toBe('refused');
    expect(await w.service(b, through((s) => ({ ...s, sig: new Uint8Array(64) }))).bootstrap(FOLD)).toBe('refused');
    expect(await w.service(b, through((s) => ({ ...s, atSeq: s.atSeq - 1n }))).bootstrap(FOLD)).toBe('refused'); // replayed as an earlier checkpoint
    expect(await w.service(b, through((s) => ({ ...s, epoch: 2 }))).bootstrap(FOLD)).toBe('refused');
    expect(await b.replica.projections.listRecords(FOLD)).toHaveProperty('size', 0);
    expect(await b.cursors.get(FOLD)).toEqual({ serverSeq: 0n, fromSnapshot: false });

    // and the device still gets everything the ordinary way
    await b.client.syncFold(FOLD);
    expect(await state(b)).toBe(await state(a));
  });

  it('does nothing when there is no snapshot, or when the device already has history', async () => {
    const w = await world();
    const [a, b] = [await w.node(0), await w.node(1)];
    expect(await w.service(b).bootstrap(FOLD)).toBe('none');
    await a.replica.writePath.submit(draft(1, 1));
    await a.client.syncFold(FOLD);
    await w.service(a).publish(FOLD);
    expect(await w.service(a).bootstrap(FOLD)).toBe('not_empty');
  });

  it('lets the relay prune only after every device has acknowledged, and a new device still catches up', async () => {
    const w = await world();
    const [a, b] = [await w.node(0), await w.node(1)];
    for (let i = 1; i <= 4; i++) await a.replica.writePath.submit(draft(i, i));
    await a.client.syncFold(FOLD);
    await b.client.syncFold(FOLD);
    await w.service(a).publish(FOLD);
    await w.service(a).acknowledge(FOLD);
    expect(w.relay.size(FOLD)).toBe(4); // b has not confirmed yet
    await w.service(b).acknowledge(FOLD);
    expect(w.relay.size(FOLD)).toBe(0);

    await a.replica.writePath.submit(draft(5, 5));
    await a.client.syncFold(FOLD);
    const c = await w.node(2);
    expect(await w.service(c).bootstrap(FOLD)).toBe('installed');
    await c.client.syncFold(FOLD);
    expect(await state(c)).toBe(await state(a));
  });

  it('a device without the snapshot cannot rebuild from a pruned log, and says so', async () => {
    const w = await world();
    const a = await w.node(0);
    for (let i = 1; i <= 3; i++) await a.replica.writePath.submit(draft(i, i));
    await a.client.syncFold(FOLD);
    await w.service(a).publish(FOLD);
    await w.service(a).acknowledge(FOLD);
    expect(w.relay.size(FOLD)).toBe(0);
    const late = await w.node(3);
    await late.client.syncFold(FOLD);
    expect(await state(late)).not.toBe(await state(a)); // the history is gone; only the snapshot can supply it
  });

  it('acknowledges nothing before the first sync', async () => {
    const w = await world();
    expect(await w.service(await w.node(0)).acknowledge(FOLD)).toBe(false);
  });
});
