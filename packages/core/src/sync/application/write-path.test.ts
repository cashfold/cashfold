import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { createReplica, createWorld, id as testId, type Replica, type World } from '../../testing/index';
import { DELETED_FIELD, isVisible, type FieldValue, type GroupRegistry, type SetDelta } from '../domain/merge';
import type { OpDraft } from './write-path';

const FOLD = testId(0xf1);
const OTHER_FOLD = testId(0xf2);
const REC = testId(0x10);
const fields = (...entries: Array<[number, FieldValue]>) => new Map<number, FieldValue>(entries);
const noSets: ReadonlyMap<number, SetDelta> = new Map();
const draft = (over: Partial<OpDraft> = {}): OpDraft => ({ fold: FOLD, rec: REC, table: 6, fields: fields([1, 'x']), sets: noSets, ...over });

async function pair(opts: { groups?: GroupRegistry } = {}): Promise<{ world: World; a: Replica; b: Replica }> {
  const world = await createWorld();
  world.addFold(FOLD);
  const a = await createReplica(world, { device: testId(0xa), ...opts });
  const b = await createReplica(world, { device: testId(0xb), ...opts });
  return { world, a, b };
}

const records = async (r: Replica, fold: Id = FOLD) => r.projections.listRecords(fold);

describe('submit (the single write path)', () => {
  it('seals, appends and projects in one step', async () => {
    const { a } = await pair();
    const res = await a.writePath.submit(draft({ fields: fields([1, 'Coffee'], [2, -450n]) }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.before).toBeUndefined();
    expect(res.value.after.fields.get(2)?.value).toBe(-450n);

    const log = await a.oplog.list(FOLD);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ origin: 'local', pushed: false });
    expect(log[0]!.sealed).toMatchObject({ fold: FOLD, rec: REC, dev: a.device, seq: 1n, epoch: 1 });
    expect(Buffer.from(log[0]!.sealed.blob).includes(Buffer.from('Coffee'))).toBe(false);
    expect((await records(a)).get(REC)?.fields.get(1)?.value).toBe('Coffee');
  });

  it('numbers ops with a per-device, gapless, strictly increasing seq and strictly increasing HLC', async () => {
    const { a } = await pair();
    for (let i = 0; i < 5; i++) await a.writePath.submit(draft({ fields: fields([1, `v${i}`]) }));
    const sealed = (await a.oplog.list(FOLD)).map((s) => s.sealed);
    expect(sealed.map((s) => s.seq)).toEqual([1n, 2n, 3n, 4n, 5n]);
    for (let i = 1; i < sealed.length; i++) {
      const [p, c] = [sealed[i - 1]!.hlc, sealed[i]!.hlc];
      expect(c.wallMs > p.wallMs || (c.wallMs === p.wallMs && c.ctr > p.ctr)).toBe(true);
    }
  });

  it('stays monotonic when the physical clock goes backwards', async () => {
    const { a } = await pair();
    a.setNow(1_000_000);
    await a.writePath.submit(draft({ fields: fields([1, 'first']) }));
    a.setNow(500);
    await a.writePath.submit(draft({ fields: fields([1, 'second']) }));
    const [x, y] = (await a.oplog.list(FOLD)).map((s) => s.sealed.hlc);
    expect(y!.wallMs).toBeGreaterThanOrEqual(x!.wallMs);
    expect((await records(a)).get(REC)?.fields.get(1)?.value).toBe('second');
  });

  it('refuses when the device holds no key for the Fold', async () => {
    const { a } = await pair();
    const res = await a.writePath.submit(draft({ fold: OTHER_FOLD }));
    expect(res).toEqual({ ok: false, error: expect.objectContaining({ code: 'no_key' }) });
    expect(await a.oplog.list(OTHER_FOLD)).toHaveLength(0);
  });

  it('refuses invalid ops and writes nothing', async () => {
    const groups: GroupRegistry = new Map([[7, [[1, 2]]]]);
    const { a } = await pair({ groups });
    const partial = await a.writePath.submit(draft({ table: 7, fields: fields([1, 'a']) }));
    expect(partial).toEqual({ ok: false, error: expect.objectContaining({ code: 'group_incomplete' }) });
    const badTable = await a.writePath.submit(draft({ table: 99 }));
    expect(badTable).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_table' }) });
    expect(await a.oplog.list(FOLD)).toHaveLength(0);
    expect((await records(a)).size).toBe(0);
  });

  it('is atomic: a failing projection write leaves no op, no seq gap and no clock advance', async () => {
    const { a } = await pair();
    a.failNextProjectionWrite();
    await expect(a.writePath.submit(draft())).rejects.toThrow('disk full');
    expect(await a.oplog.list(FOLD)).toHaveLength(0);
    expect((await records(a)).size).toBe(0);
    const ok = await a.writePath.submit(draft());
    expect(ok.ok).toBe(true);
    expect((await a.oplog.list(FOLD))[0]!.sealed.seq).toBe(1n);
  });
});

describe('applyRemote (same pipeline for ops from other devices)', () => {
  it('applies an op from another device and converges with it', async () => {
    const { a, b } = await pair();
    await a.writePath.submit(draft({ fields: fields([1, 'from-a']) }));
    for (const s of await a.oplog.list(FOLD)) {
      const r = await b.writePath.applyRemote(s.sealed);
      expect(r).toMatchObject({ ok: true, value: { kind: 'applied' } });
    }
    expect(await records(b)).toEqual(await records(a));
    expect((await b.oplog.list(FOLD))[0]).toMatchObject({ origin: 'remote', pushed: true });
  });

  it('is idempotent: a duplicate delivery changes nothing, and an echo of an own op is a duplicate', async () => {
    const { a, b } = await pair();
    await a.writePath.submit(draft());
    const [stored] = await a.oplog.list(FOLD);
    expect(await b.writePath.applyRemote(stored!.sealed)).toMatchObject({ ok: true, value: { kind: 'applied' } });
    const before = await records(b);
    expect(await b.writePath.applyRemote(stored!.sealed)).toMatchObject({ ok: true, value: { kind: 'duplicate' } });
    expect(await a.writePath.applyRemote(stored!.sealed)).toMatchObject({ ok: true, value: { kind: 'duplicate' } });
    expect(await records(b)).toEqual(before);
    expect(await b.oplog.list(FOLD)).toHaveLength(1);
  });

  it('two devices editing the same record offline converge whatever the delivery order', async () => {
    const { a, b } = await pair();
    await a.writePath.submit(draft({ fields: fields([1, 'name-from-a'], [2, 1n]) }));
    await b.writePath.submit(draft({ fields: fields([2, 2n], [3, 'note-from-b']) }));
    const fromA = (await a.oplog.list(FOLD)).map((s) => s.sealed);
    const fromB = (await b.oplog.list(FOLD)).map((s) => s.sealed);
    for (const s of fromB) await a.writePath.applyRemote(s);
    for (const s of [...fromA].reverse()) await b.writePath.applyRemote(s);
    expect(await records(a)).toEqual(await records(b));
    const merged = (await records(a)).get(REC)!;
    expect(merged.fields.get(1)?.value).toBe('name-from-a');
    expect(merged.fields.get(3)?.value).toBe('note-from-b');
  });

  it('quarantines a tampered op instead of applying it, and keeps working', async () => {
    const { a, b } = await pair();
    await a.writePath.submit(draft());
    const [stored] = await a.oplog.list(FOLD);
    const tampered = { ...stored!.sealed, seq: 99n };
    expect(await b.writePath.applyRemote(tampered)).toMatchObject({ ok: true, value: { kind: 'quarantined', reason: 'bad_signature' } });
    expect(await b.oplog.list(FOLD)).toHaveLength(0);
    expect((await b.oplog.listQuarantined(FOLD))[0]).toMatchObject({ reason: 'bad_signature' });
    expect(await b.writePath.applyRemote(stored!.sealed)).toMatchObject({ ok: true, value: { kind: 'applied' } });
  });

  it('quarantines a second, different op that reuses a device sequence number (equivocation)', async () => {
    const { a, b } = await pair();
    await a.writePath.submit(draft({ fields: fields([1, 'honest']) }));
    const [stored] = await a.oplog.list(FOLD);
    expect(await b.writePath.applyRemote(stored!.sealed)).toMatchObject({ ok: true, value: { kind: 'applied' } });
    // A clone of the device (restored backup, copied profile, or an attacker holding its key) signs a different op under the same (device, seq).
    const clone = await a.fork();
    await clone.writePath.submit(draft({ fields: fields([1, 'conflicting']) }));
    const second = (await clone.oplog.list(FOLD))[0]!;
    expect(second.sealed.op).not.toBe(stored!.sealed.op);
    expect(second.sealed.seq).toBe(stored!.sealed.seq);
    expect(await b.writePath.applyRemote(second.sealed)).toMatchObject({ ok: true, value: { kind: 'quarantined', reason: 'seq_conflict' } });
    expect((await records(b)).get(REC)?.fields.get(1)?.value).toBe('honest');
    expect(await b.oplog.list(FOLD)).toHaveLength(1);
  });

  it('quarantines ops from unknown devices and ops for epochs it has no key for', async () => {
    const { world, a, b } = await pair();
    await a.writePath.submit(draft());
    const [stored] = await a.oplog.list(FOLD);
    expect(await b.writePath.applyRemote({ ...stored!.sealed, dev: testId(0xdead) })).toMatchObject({ ok: true, value: { kind: 'quarantined', reason: 'unknown_signer' } });
    world.setCurrentEpoch(FOLD, 2);
    await world.addFoldKey(FOLD, 2);
    await a.writePath.submit(draft({ fields: fields([1, 'epoch2']) }));
    world.forgetFoldKey(FOLD, 2);
    const epoch2 = (await a.oplog.list(FOLD)).find((s) => s.sealed.epoch === 2)!;
    expect(await b.writePath.applyRemote(epoch2.sealed)).toMatchObject({ ok: true, value: { kind: 'quarantined', reason: 'unknown_key' } });
  });

  it('quarantines an op whose clock is more than 24 h ahead', async () => {
    const { a, b } = await pair();
    a.setNow(Date.now() + 3 * 24 * 3600 * 1000);
    await a.writePath.submit(draft());
    b.setNow(Date.now());
    const [stored] = await a.oplog.list(FOLD);
    expect(await b.writePath.applyRemote(stored!.sealed)).toMatchObject({ ok: true, value: { kind: 'quarantined', reason: 'clock_ahead' } });
    expect((await records(b)).size).toBe(0);
  });

  it('merges deletes and restores like any other field', async () => {
    const { a, b } = await pair();
    await a.writePath.submit(draft({ fields: fields([1, 'x']) }));
    await a.writePath.submit(draft({ fields: fields([DELETED_FIELD, true]) }));
    for (const s of await a.oplog.list(FOLD)) await b.writePath.applyRemote(s.sealed);
    expect(isVisible((await records(b)).get(REC)!)).toBe(false);
    await b.writePath.submit(draft({ fields: fields([DELETED_FIELD, false]) }));
    expect(isVisible((await records(b)).get(REC)!)).toBe(true);
  });
});

describe('rebuild (replay the op log into empty projections)', () => {
  it('reproduces the live projections exactly, including remote ops', async () => {
    const { a, b } = await pair();
    await a.writePath.submit(draft({ fields: fields([1, 'a1'], [2, 10n]) }));
    await b.writePath.submit(draft({ rec: testId(0x11), fields: fields([1, 'b1']) }));
    await a.writePath.submit(draft({ fields: fields([1, 'a2'], [DELETED_FIELD, true]) }));
    for (const s of await b.oplog.list(FOLD)) await a.writePath.applyRemote(s.sealed);
    const live = await records(a);

    const report = await a.writePath.rebuild(FOLD);
    expect(report).toMatchObject({ ok: true, value: { opsReplayed: 3, failed: 0 } });
    expect(await records(a)).toEqual(live);
  });

  it('is deterministic and repeatable', async () => {
    const { a } = await pair();
    for (let i = 0; i < 4; i++) await a.writePath.submit(draft({ fields: fields([i + 1, BigInt(i)]) }));
    await a.writePath.rebuild(FOLD);
    const once = await records(a);
    await a.writePath.rebuild(FOLD);
    expect(await records(a)).toEqual(once);
  });

  it('skips ops that no longer open and reports them, instead of aborting', async () => {
    const { world, a } = await pair();
    await a.writePath.submit(draft({ fields: fields([1, 'kept']) }));
    await a.writePath.submit(draft({ rec: testId(0x12), fields: fields([1, 'lost']) }));
    a.corruptStoredOp(1);
    const report = await a.writePath.rebuild(FOLD);
    expect(report).toMatchObject({ ok: true, value: { opsReplayed: 1, failed: 1 } });
    expect((await records(a)).has(testId(0x12))).toBe(false);
    expect((await records(a)).get(REC)?.fields.get(1)?.value).toBe('kept');
    expect(world).toBeDefined();
  });

  it('only touches the requested Fold', async () => {
    const { world, a } = await pair();
    world.addFold(OTHER_FOLD);
    await a.writePath.submit(draft());
    await a.writePath.submit(draft({ fold: OTHER_FOLD, fields: fields([1, 'other']) }));
    await a.writePath.rebuild(FOLD);
    expect((await records(a, OTHER_FOLD)).get(REC)?.fields.get(1)?.value).toBe('other');
  });
});
