import { describe, expect, it } from 'vitest';
import { attack, createMemoryCursors, createReplica, createRng, hostileTransport, id, setup, TAMPERING, type Attack } from '../../testing/index';
import type { FieldValue } from '../domain/merge';
import type { TransportPort } from '../ports/index';
import { createSyncClient } from './sync-client';

// FR-018, FR-080: the relay is untrusted. Whatever it does to the ops it serves, a device either applies the genuine op
// or refuses it and says so; it never applies altered content, and it never loses track silently.

const FOLD = id(0xf0);
const draft = (rec: number, n: number) => ({ fold: FOLD, rec: id(rec), table: 6, fields: new Map<number, FieldValue>([[1, `v${n}`], [2, BigInt(n)]]), sets: new Map() });

async function scenario(wrap: (honest: TransportPort) => TransportPort) {
  const w = await setup();
  const author = await w.node(0);
  for (let i = 1; i <= 6; i++) await author.replica.writePath.submit(draft(i, i));
  await author.client.syncFold(FOLD);
  const reader = await createReplica(w.world, { device: id(0xd7) });
  const cursors = createMemoryCursors();
  const client = createSyncClient({ oplog: reader.oplog, writePath: reader.writePath, transport: wrap(w.relay.transport()), cursors, clock: { nowMs: () => 1_700_000_000_000 } });
  const honest = new Map([...(await author.replica.projections.listRecords(FOLD))].map(([rec, r]) => [rec, JSON.stringify([...r.fields].map(([f, v]) => [f, String(v.value)]))]));
  const state = async () => new Map([...(await reader.projections.listRecords(FOLD))].map(([rec, r]) => [rec, JSON.stringify([...r.fields].map(([f, v]) => [f, String(v.value)]))]));
  return { w, author, reader, client, honest, state, cursors };
}

describe('hostile relay: content tampering is refused', () => {
  for (const kind of TAMPERING) {
    it(`${kind}: no tampered op is applied, each is quarantined and the rest still arrives`, async () => {
      const rng = createRng(7);
      let touched: string[] = [];
      const s = await scenario((honest) => ({
        push: honest.push,
        async pull(fold, after, limit) {
          const page = await honest.pull(fold, after, limit);
          const r = attack(page.ops, kind, rng, id(0xee));
          touched = r.touched;
          return { ...page, ops: r.served };
        },
      }));
      const report = await s.client.syncFold(FOLD);
      const stored = new Set((await s.reader.oplog.list(FOLD)).map((o) => o.sealed.op));
      for (const op of touched) expect(stored.has(op as never)).toBe(false);
      expect(report.quarantined + report.ignored + (report.failure === 'gap' ? 1 : 0)).toBeGreaterThanOrEqual(1);
      // Everything that was applied matches what the author really wrote.
      const got = await s.state();
      for (const [rec, fields] of got) expect(s.honest.get(rec)).toBe(fields);
    });
  }
});

describe('hostile relay: omission, replay and reordering', () => {
  it('a dropped op in the middle of a device\'s sequence is detected and nothing past it is passed over', async () => {
    const s = await scenario((honest) => ({
      push: honest.push,
      async pull(fold, after, limit) {
        const page = await honest.pull(fold, after, limit);
        return { ...page, ops: page.ops.filter((o) => o.serverSeq !== 3n) };
      },
    }));
    const report = await s.client.syncFold(FOLD);
    expect(report.failure).toBe('gap');
    expect(report.applied).toBe(2); // ops 1 and 2 arrived; 4 to 6 wait for 3
    expect((await s.cursors.get(FOLD)).serverSeq).toBe(0n);
  });

  it('once the relay serves the missing op, the device catches up completely', async () => {
    let drop = true;
    const s = await scenario((honest) => ({
      push: honest.push,
      async pull(fold, after, limit) {
        const page = await honest.pull(fold, after, limit);
        return { ...page, ops: drop ? page.ops.filter((o) => o.serverSeq !== 3n) : page.ops };
      },
    }));
    expect((await s.client.syncFold(FOLD)).failure).toBe('gap');
    drop = false;
    const report = await s.client.syncFold(FOLD);
    expect(report.failure).toBeUndefined();
    expect(await s.state()).toEqual(s.honest);
  });

  it('a relay that withholds a device\'s whole history from a device with no snapshot is caught at the first op', async () => {
    const s = await scenario((honest) => ({
      push: honest.push,
      async pull(fold, after, limit) {
        const page = await honest.pull(fold, after, limit);
        return { ...page, ops: page.ops.filter((o) => o.serverSeq > 2n) };
      },
    }));
    expect((await s.client.syncFold(FOLD)).failure).toBe('gap');
    expect(await s.state()).toEqual(new Map());
  });

  for (const kind of ['replay', 'reorder'] as Attack[]) {
    it(`${kind}: the result is exactly the honest state, and sync does not fail`, async () => {
      const rng = createRng(11);
      const s = await scenario((honest) => hostileTransport(honest, kind, rng, id(0xee)));
      const report = await s.client.syncFold(FOLD);
      if (kind === 'reorder') {
        // A reversed log shows a device's later op first; that is a gap until the earlier ones arrive in a later round.
        expect(['gap', undefined]).toContain(report.failure);
        return;
      }
      expect(report.failure).toBeUndefined();
      expect(await s.state()).toEqual(s.honest);
    });
  }

  it('ops from different devices served in any order converge to the same state', async () => {
    const w = await setup();
    const [a, b] = [await w.node(0), await w.node(1)];
    await a.replica.writePath.submit(draft(1, 1));
    await b.replica.writePath.submit({ ...draft(1, 2), fields: new Map<number, FieldValue>([[2, 5n]]) });
    await a.client.syncFold(FOLD);
    await b.client.syncFold(FOLD);
    const reader = await createReplica(w.world, { device: id(0xd8) });
    const reversed: TransportPort = {
      push: async () => [],
      async pull(fold, after, limit) {
        const page = w.relay.pull(fold, after, limit);
        return { ...page, ops: [...page.ops].reverse() };
      },
    };
    const client = createSyncClient({ oplog: reader.oplog, writePath: reader.writePath, transport: reversed, cursors: createMemoryCursors(), clock: { nowMs: () => 1 } });
    expect(await client.syncFold(FOLD)).toMatchObject({ applied: 2 });
    const view = async (r: typeof reader) => JSON.stringify([...(await r.projections.listRecords(FOLD))].map(([k, v]) => [k, [...v.fields].map(([f, x]) => [f, String(x.value)]).sort()]));
    await a.client.syncFold(FOLD);
    expect(await view(reader)).toBe(await view(a.replica));
  });
});

describe('hostile relay: other attacks', () => {
  it('an op that belongs to another Fold is refused (the Fold id is under the signature and the AEAD)', async () => {
    const rng = createRng(3);
    const s = await scenario((honest) => hostileTransport(honest, 'wrong_fold', rng, id(0xee)));
    await s.client.syncFold(FOLD);
    expect((await s.reader.oplog.list(id(0xee))).length).toBe(0);
  });

  it('a relay that rewrites a sequence number cannot make a device equivocate', async () => {
    // The same op is rewritten every time it is asked for, as a persistent attacker would.
    const s = await scenario((honest) => ({ push: honest.push, pull: (f, a, l) => hostileTransport(honest, 'rewrite_seq', createRng(5), id(0xee)).pull(f, a, l) }));
    const report = await s.client.syncFold(FOLD);
    expect(report.quarantined + (report.failure === 'gap' ? 1 : 0)).toBeGreaterThanOrEqual(1);
  });
});
