import { describe, expect, it } from 'vitest';
import { attack, createCluster, createRng, hostileTransport, id, MemoryRelay, runMergeTrial, runScenario, TAMPERING, type Attack, type PulledOp } from './index.js';
import type { FieldValue } from '../sync/domain/merge.js';
import { createReplica, createWorld } from './world.js';

describe('replica simulator (SC-004: arbitrary offline edits converge in any delivery order, with duplicates)', () => {
  it('merge layer: 1,000 randomised trials all converge', () => {
    let ops = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const r = runMergeTrial(seed);
      expect(r.converged, `seed ${seed}`).toBe(true);
      ops += r.opCount;
    }
    expect(ops).toBeGreaterThan(10_000);
  });

  it('full pipeline (real signing and encryption): randomised trials converge with nothing quarantined', async () => {
    const trials = Number(process.env['SC004_TRIALS'] ?? (process.env['CI'] ? 1000 : 40));
    for (let seed = 1; seed <= trials; seed++) {
      const r = await runScenario(seed);
      expect(r.converged, `seed ${seed}`).toBe(true);
      expect(r.quarantined, `seed ${seed}`).toBe(0);
    }
  }, 600_000);

  it('a partitioned replica catches up and agrees after it reconnects', async () => {
    const cluster = await createCluster({ replicas: 3 });
    cluster.setOffline(2, true);
    await cluster.edit(0, { rec: id(1), table: 6, fields: new Map([[1, 'a']]), sets: new Map() });
    await cluster.edit(2, { rec: id(1), table: 6, fields: new Map([[2, 'offline edit']]), sets: new Map() });
    await cluster.sync(0);
    await cluster.sync(1);
    expect((await cluster.replicas[1]!.projections.getRecord(cluster.fold, id(1)))?.fields.has(2)).toBe(false);
    await cluster.settle();
    const [a, b, c] = await cluster.states();
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a!.get(id(1))?.fields.size).toBe(2);
  });
});

describe('hostile relay harness (SC-006)', () => {
  async function victimSetup() {
    const cluster = await createCluster({ replicas: 2 });
    for (let i = 0; i < 6; i++) await cluster.edit(0, { rec: id(i % 3 + 1), table: 6, fields: new Map<number, FieldValue>([[1, `v${i}`], [2, BigInt(i)]]), sets: new Map() });
    await cluster.sync(0);
    const honest = cluster.relay.pull(cluster.fold, 0n, 1000).ops;
    const victim = await createReplica(cluster.world, { device: id(0x99) });
    const control = await createReplica(cluster.world, { device: id(0x98) });
    return { cluster, honest, victim, control };
  }

  it.each(TAMPERING)('%s: every tampered op is rejected and nothing else is corrupted', async (kind: Attack) => {
    const { cluster, honest, victim, control } = await victimSetup();
    const { served, touched } = attack(honest, kind, createRng(7), id(0xbad));
    expect(touched.length).toBeGreaterThan(0);

    const outcomes = new Map<string, string>();
    for (const op of served) {
      const r = await victim.writePath.applyRemote(op.sealed);
      if (r.ok) outcomes.set(op.sealed.op, r.value.kind === 'quarantined' ? `quarantined:${r.value.reason}` : r.value.kind);
    }
    for (const op of touched) {
      // Content tampering breaks the signature; a relabelled Fold is one this device holds no key for.
      expect(outcomes.get(op), kind).toBe(kind === 'wrong_fold' ? 'ignored' : 'quarantined:bad_signature');
    }
    for (const q of await victim.oplog.listQuarantined(cluster.fold)) expect(q.reason).toBe('bad_signature');
    expect(await victim.oplog.listQuarantined(id(0xbad))).toHaveLength(0);

    // The control replica sees only the untouched ops: the victim's state must be exactly that.
    for (const op of honest.filter((o) => !touched.includes(o.sealed.op))) await control.writePath.applyRemote(op.sealed);
    expect(await victim.projections.listRecords(cluster.fold)).toEqual(await control.projections.listRecords(cluster.fold));
  });

  it('replay: redelivered ops change nothing', async () => {
    const { cluster, honest, victim, control } = await victimSetup();
    const { served } = attack(honest, 'replay', createRng(3), id(0xbad));
    for (const op of served) await victim.writePath.applyRemote(op.sealed);
    for (const op of honest) await control.writePath.applyRemote(op.sealed);
    expect(await victim.projections.listRecords(cluster.fold)).toEqual(await control.projections.listRecords(cluster.fold));
    expect(await victim.oplog.list(cluster.fold)).toHaveLength(honest.length);
    expect(await victim.oplog.listQuarantined(cluster.fold)).toHaveLength(0);
  });

  it('reorder: delivery order does not change the result', async () => {
    const { cluster, honest, victim, control } = await victimSetup();
    const { served } = attack(honest, 'reorder', createRng(3), id(0xbad));
    expect(served.map((o) => o.serverSeq)).not.toEqual(honest.map((o) => o.serverSeq));
    for (const op of served) await victim.writePath.applyRemote(op.sealed);
    for (const op of honest) await control.writePath.applyRemote(op.sealed);
    expect(await victim.projections.listRecords(cluster.fold)).toEqual(await control.projections.listRecords(cluster.fold));
  });

  it('drop: a missing op leaves a visible gap in the device sequence for the sync engine to detect', async () => {
    const { honest } = await victimSetup();
    // Drop an op from the middle of the stream so the hole is detectable from the remaining sequence numbers.
    const middle = honest.filter((_, i) => i !== 2);
    const seqs = middle.map((o: PulledOp) => o.sealed.seq);
    const contiguous = seqs.every((s, i) => i === 0 || s === seqs[i - 1]! + 1n);
    expect(contiguous).toBe(false);
    // The harness's own drop picks a random op and removes exactly one.
    const { served, touched } = attack(honest, 'drop', createRng(5), id(0xbad));
    expect(served).toHaveLength(honest.length - 1);
    expect(served.map((o) => o.sealed.op)).not.toContain(touched[0]);
  });

  it('hostileTransport applies the attack to pulls and leaves pushes honest', async () => {
    const relay = new MemoryRelay();
    const t = hostileTransport(relay.transport(), 'reorder', createRng(1), id(0xbad));
    const { cluster, honest } = await victimSetup();
    await t.push(cluster.fold, honest.map((o) => o.sealed));
    const pulled = await t.pull(cluster.fold, 0n, 100);
    expect(pulled.ops).toHaveLength(honest.length);
    expect(pulled.ops.map((o) => o.serverSeq)).toEqual(honest.map((o) => o.serverSeq).reverse());
  });

  it('refuses to attack a log too short to attack', () => {
    expect(() => attack([], 'drop', createRng(1), id(1))).toThrow(RangeError);
    expect(createWorld).toBeDefined();
  });
});
