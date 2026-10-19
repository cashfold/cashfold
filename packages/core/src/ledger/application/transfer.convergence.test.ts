import { describe, expect, it } from 'vitest';
import { createCluster, createRng, date, id, type Cluster } from '../../testing/index';
import { accountFieldPatch } from '../domain/account';
import { LEDGER_GROUPS } from '../domain/ledger-groups';
import { TABLE, TRANSFER_FIELD } from '../domain/tables';
import { transferFieldPatch } from '../domain/transfer';
import { DELETED_FIELD } from '../../sync/domain/merge';
import { buildLedger } from './projections/ledger';

const [A, B, C, T] = [id(1), id(2), id(3), id(10)];

async function seeded(replicas = 2): Promise<Cluster> {
  const c = await createCluster({ replicas, groups: LEDGER_GROUPS });
  for (const [rec, name, currency] of [[A, 'A', 'USD'], [B, 'B', 'EUR'], [C, 'C', 'GBP']] as const) {
    await c.edit(0, { rec, table: TABLE.account, sets: new Map(), fields: accountFieldPatch({ kind: 'checking', name, currency: currency as never, openingBalanceMinor: 0n, openingDate: date(2020, 1, 1), includeInNetWorth: true, creditLimitMinor: null, icon: null, color: 0, sortOrder: 0, archived: false }) });
  }
  await c.edit(0, {
    rec: T, table: TABLE.transfer, sets: new Map(),
    fields: transferFieldPatch({ fromAccountId: A, toAccountId: B, fromAmountMinor: 10_000n, toAmountMinor: 9_137n, fxRateId: null, localDate: date(2026, 1, 5), occurredUtcMs: Date.UTC(2026, 0, 5), tzOffsetMin: 0, note: '', status: 'posted' }),
  });
  await c.settle();
  return c;
}

const edit = (c: Cluster, i: number, amounts: { from: bigint; to: bigint; toAccount?: typeof B }) =>
  c.edit(i, {
    rec: T, table: TABLE.transfer, sets: new Map(),
    fields: transferFieldPatch({ fromAccountId: A, toAccountId: amounts.toAccount ?? B, fromAmountMinor: amounts.from, toAmountMinor: amounts.to, fxRateId: null }),
  });

const view = async (c: Cluster, i: number) => {
  const x = buildLedger(await c.replicas[i]!.projections.listRecords(c.fold)).transfers.get(T)!;
  return { from: x.fromAmountMinor, to: x.toAmountMinor, toAccount: x.toAccountId, note: x.note };
};

describe('concurrent edits of a transfer (FR-045, FR-075)', () => {
  it('converge to one whole version of the amount group, never half of each', async () => {
    const c = await seeded();
    c.setOffline(0, true);
    c.setOffline(1, true);
    await edit(c, 0, { from: 20_000n, to: 18_000n });
    await edit(c, 1, { from: 30_000n, to: 27_000n, toAccount: C });
    await c.settle();
    const [a, b] = [await view(c, 0), await view(c, 1)];
    expect(a).toEqual(b);
    // either device's edit won as a whole; no mixture such as 20,000 out and 27,000 in
    expect([[20_000n, 18_000n, B], [30_000n, 27_000n, C]]).toContainEqual([a.from, a.to, a.toAccount]);
  });

  it('keeps an edit of the note made at the same time as an edit of the amounts', async () => {
    const c = await seeded();
    c.setOffline(0, true);
    c.setOffline(1, true);
    await edit(c, 0, { from: 20_000n, to: 18_000n });
    await c.edit(1, { rec: T, table: TABLE.transfer, sets: new Map(), fields: new Map([[TRANSFER_FIELD.note, 'rent']]) });
    await c.settle();
    expect(await view(c, 0)).toEqual({ from: 20_000n, to: 18_000n, toAccount: B, note: 'rent' });
    expect(await view(c, 1)).toEqual(await view(c, 0));
  });

  it('refuses a device that writes only half of the group', async () => {
    const c = await seeded();
    await expect(c.edit(0, { rec: T, table: TABLE.transfer, sets: new Map(), fields: new Map([[TRANSFER_FIELD.toAmountMinor, 5n]]) })).rejects.toThrow(/group_incomplete/);
  });

  it('a delete on one device and an edit on another both end up the same everywhere', async () => {
    const c = await seeded(3);
    for (const i of [0, 1, 2]) c.setOffline(i, true);
    await c.edit(0, { rec: T, table: TABLE.transfer, sets: new Map(), fields: new Map([[DELETED_FIELD, true]]) });
    await edit(c, 1, { from: 5_000n, to: 4_500n });
    await c.edit(2, { rec: T, table: TABLE.transfer, sets: new Map(), fields: new Map([[TRANSFER_FIELD.note, 'late']]) });
    await c.settle();
    const states = await c.states();
    const ledgers = states.map((s) => buildLedger(s));
    for (const l of ledgers) {
      expect(l.transfers.has(T)).toBe(ledgers[0]!.transfers.has(T));
      expect(l.deletedTransfers.get(T)?.transfer).toEqual(ledgers[0]!.deletedTransfers.get(T)?.transfer);
    }
  });

  it('holds over 200 random rounds with shuffled and duplicated delivery', { timeout: 120_000 }, async () => {
    const rng = createRng(7);
    for (let round = 0; round < 200; round++) {
      const c = await seeded(3);
      for (const i of [0, 1, 2]) c.setOffline(i, true);
      for (let k = 0; k < 4; k++) {
        const who = rng.int(3);
        const n = BigInt(1 + rng.int(9)) * 1_000n;
        if (rng.chance(0.2)) await c.edit(who, { rec: T, table: TABLE.transfer, sets: new Map(), fields: new Map([[TRANSFER_FIELD.note, `n${rng.int(5)}`]]) });
        else await edit(c, who, { from: n, to: n - 100n, ...(rng.chance(0.5) && { toAccount: C }) });
      }
      for (const i of [0, 1, 2]) c.setOffline(i, false);
      for (let pass = 0; pass < 3; pass++) for (let i = 0; i < 3; i++) await c.sync(i, { rng, duplicates: true });
      const seen = [await view(c, 0), await view(c, 1), await view(c, 2)];
      expect(seen[1]).toEqual(seen[0]);
      expect(seen[2]).toEqual(seen[0]);
      // the amounts of the survivor come from one edit: to is always from minus 100 (or the seed's pair)
      const pair = seen[0]!;
      expect(pair.to === pair.from - 100n || (pair.from === 10_000n && pair.to === 9_137n)).toBe(true);
    }
  });
});
