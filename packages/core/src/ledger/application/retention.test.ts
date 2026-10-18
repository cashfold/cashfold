import { describe, expect, it } from 'vitest';
import { buildNeedsAttention, createRepair } from '../../sync/application/repair';
import { DELETED_FIELD } from '../../sync/domain/merge';
import { createCluster, date, id, type Cluster } from '../../testing/index';
import { LEDGER_GROUPS } from '../domain/ledger-groups';
import { TABLE, TXN_FIELD } from '../domain/tables';
import { transactionFieldPatch } from '../domain/transaction';
import { accountFieldPatch } from '../domain/account';
import { accountBalance } from './balance';
import { buildLedger } from './projections/ledger';
import { ledgerRepairRules } from './repair-rules';
import { RETENTION_MS } from './transaction-commands';
import { purgeExpired } from './purge-deleted';
import { recentlyDeleted } from './queries/recently-deleted';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000;
const ACCOUNT = id(1);
const TXN = id(2);
const OTHER = id(3);

async function twoDevices(): Promise<Cluster> {
  const c = await createCluster({ replicas: 2, groups: LEDGER_GROUPS });
  for (const r of c.replicas) r.setNow(T0);
  await c.edit(0, { rec: ACCOUNT, table: TABLE.account, fields: accountFieldPatch({ kind: 'checking', name: 'Main', currency: 'USD' as never, openingBalanceMinor: 1_000n, openingDate: date(2026, 1, 1), includeInNetWorth: true, creditLimitMinor: null, icon: null, color: 0, sortOrder: 0, archived: false }), sets: new Map() });
  for (const rec of [TXN, OTHER]) {
    await c.edit(0, {
      rec, table: TABLE.transaction, sets: new Map(),
      fields: transactionFieldPatch({
        accountId: ACCOUNT, direction: 'expense', amountMinor: -100n, currency: 'USD' as never, baseAmountMinor: -100n, baseCurrency: 'USD', fxRateId: null, fxBaseRateId: null,
        occurredUtcMs: Date.UTC(2026, 2, 1, 12), tzOffsetMin: 0, localDate: date(2026, 3, 1), status: 'posted', note: rec === TXN ? 'doomed' : 'kept',
      }),
    });
  }
  await c.settle();
  return c;
}

const ledgerOf = async (c: Cluster, i: number) => buildLedger(await c.replicas[i]!.projections.listRecords(c.fold));
/** Devices' wall clocks are close in real life (an op more than a day ahead is refused), so time moves for all of them. */
const clockTo = (c: Cluster, ms: number): void => c.replicas.forEach((r) => r.setNow(ms));
const deleteOn = (c: Cluster, i: number, rec = TXN, value = true) => c.edit(i, { rec, table: TABLE.transaction, fields: new Map([[DELETED_FIELD, value]]), sets: new Map() });
const purge = (c: Cluster, i: number, nowMs: number) => purgeExpired({ oplog: c.replicas[i]!.oplog, projections: c.replicas[i]!.projections }, c.fold, nowMs);

describe('deleted records are recoverable for 30 days on every device', () => {
  it('a device that was offline during the delete sees it in Recently deleted afterwards and can restore it', async () => {
    const c = await twoDevices();
    c.setOffline(1, true);
    c.replicas[0]!.setNow(T0 + DAY);
    await deleteOn(c, 0);
    await c.sync(0);
    expect((await ledgerOf(c, 1)).transactions.has(TXN)).toBe(true); // B has not heard yet

    clockTo(c, T0 + 10 * DAY);
    c.setOffline(1, false);
    await c.settle();
    const b = await ledgerOf(c, 1);
    expect(b.transactions.has(TXN)).toBe(false);
    expect(recentlyDeleted(b, T0 + 10 * DAY).map((d) => d.transaction.id)).toEqual([TXN]);

    await deleteOn(c, 1, TXN, false); // B restores
    await c.settle();
    for (const i of [0, 1]) expect((await ledgerOf(c, i)).transactions.get(TXN)?.note).toBe('doomed');
  });

  it('counts the 30 days from the delete itself, not from when a device heard about it', async () => {
    const c = await twoDevices();
    c.setOffline(1, true);
    c.replicas[0]!.setNow(T0);
    await deleteOn(c, 0);
    await c.sync(0);
    // B only hears about it on day 29. It must still have one day left to restore, whatever its own clock says.
    clockTo(c, T0 + 29 * DAY);
    c.setOffline(1, false);
    await c.settle();
    expect(await purge(c, 1, T0 + 29 * DAY)).toEqual([]);
    const list = recentlyDeleted(await ledgerOf(c, 1), T0 + 29 * DAY);
    expect(list.map((d) => d.daysLeft)).toEqual([1]);
    await deleteOn(c, 1, TXN, false);
    await c.settle();
    expect((await ledgerOf(c, 0)).transactions.has(TXN)).toBe(true);
  });

  it('reports how many days are left, rounding up, and nothing once the window has passed', async () => {
    const c = await twoDevices();
    await deleteOn(c, 0);
    const ledger = await ledgerOf(c, 0);
    const daysLeft = (now: number) => recentlyDeleted(ledger, now).map((d) => d.daysLeft);
    expect(daysLeft(T0)).toEqual([30]);
    expect(daysLeft(T0 + 29 * DAY + 1)).toEqual([1]);
    expect(daysLeft(T0 + RETENTION_MS)).toEqual([]);
  });
});

describe('purge after 30 days', () => {
  it('removes the record on every device, keeps everything else, and the balance is unchanged', async () => {
    const c = await twoDevices();
    await deleteOn(c, 0);
    await c.settle();
    const now = T0 + RETENTION_MS + 1;
    for (const i of [0, 1]) expect(await purge(c, i, now)).toEqual([TXN]);
    for (const i of [0, 1]) {
      const ledger = await ledgerOf(c, i);
      expect(ledger.transactions.has(TXN)).toBe(false);
      expect(ledger.deleted.has(TXN)).toBe(false);
      expect(ledger.transactions.get(OTHER)?.note).toBe('kept');
      expect(await c.replicas[i]!.projections.getRecord(c.fold, TXN)).toBeUndefined();
      expect(await c.replicas[i]!.projections.isPurged(c.fold, TXN)).toBe(true);
      expect(accountBalance(ledger, ACCOUNT)).toEqual({ ok: true, value: 900n });
    }
  });

  it('leaves records deleted less than 30 days ago, and live records, alone', async () => {
    const c = await twoDevices();
    await deleteOn(c, 0);
    expect(await purge(c, 0, T0 + RETENTION_MS - 1)).toEqual([]);
    expect(await purge(c, 0, T0 + RETENTION_MS)).toEqual([TXN]);
    expect((await ledgerOf(c, 0)).transactions.has(OTHER)).toBe(true);
  });

  it('is idempotent', async () => {
    const c = await twoDevices();
    await deleteOn(c, 0);
    const now = T0 + RETENTION_MS + 1;
    expect(await purge(c, 0, now)).toEqual([TXN]);
    expect(await purge(c, 0, now)).toEqual([]);
  });

  it('erases the payload of the purged record\'s ops but keeps their identity', async () => {
    const c = await twoDevices();
    await deleteOn(c, 0);
    const before = await c.replicas[0]!.oplog.list(c.fold);
    await purge(c, 0, T0 + RETENTION_MS + 1);
    const after = await c.replicas[0]!.oplog.list(c.fold);
    expect(after.map((o) => o.sealed.op)).toEqual(before.map((o) => o.sealed.op));
    const forTxn = after.filter((o) => o.sealed.rec === TXN);
    expect(forTxn.length).toBeGreaterThan(0);
    expect(forTxn.every((o) => o.sealed.blob.length === 0)).toBe(true);
    expect(after.filter((o) => o.sealed.rec !== TXN).every((o) => o.sealed.blob.length > 0)).toBe(true);
  });

  it('stays purged when the log is replayed from scratch', async () => {
    const c = await twoDevices();
    await deleteOn(c, 0);
    await purge(c, 0, T0 + RETENTION_MS + 1);
    const report = await c.replicas[0]!.writePath.rebuild(c.fold);
    expect(report.ok && report.value.failed).toBe(0);
    const ledger = await ledgerOf(c, 0);
    expect(ledger.transactions.has(TXN)).toBe(false);
    expect(ledger.transactions.has(OTHER)).toBe(true);
    expect(ledger.deleted.has(TXN)).toBe(false);
  });

  it('a re-delivered old op for a purged record is a harmless duplicate, not a resurrection', async () => {
    const c = await twoDevices();
    await deleteOn(c, 0);
    await c.settle();
    await purge(c, 0, T0 + RETENTION_MS + 1);
    const old = (await c.replicas[0]!.oplog.list(c.fold)).filter((o) => o.sealed.rec === TXN);
    for (const o of old) expect(await c.replicas[0]!.writePath.applyRemote(o.sealed)).toEqual({ ok: true, value: { kind: 'duplicate' } });
    expect((await ledgerOf(c, 0)).transactions.has(TXN)).toBe(false);
  });
});

describe('late ops for a purged record', () => {
  it('are quarantined and shown in Needs attention, not applied and not lost', async () => {
    const c = await twoDevices();
    c.setOffline(1, true);
    await deleteOn(c, 0);
    await c.sync(0);
    // B, offline, edits the doomed transaction's note while it still looks alive to B.
    clockTo(c, T0 + 5 * DAY);
    await c.edit(1, { rec: TXN, table: TABLE.transaction, fields: new Map([[TXN_FIELD.note, 'edited late']]), sets: new Map() });

    // A purges at day 31 and only then hears from B.
    clockTo(c, T0 + RETENTION_MS + DAY);
    await purge(c, 0, T0 + RETENTION_MS + DAY);
    c.setOffline(1, false);
    await c.sync(1);
    await c.sync(0);

    const quarantined = await c.replicas[0]!.oplog.listQuarantined(c.fold);
    expect(quarantined.map((q) => [q.sealed.rec, q.reason])).toEqual([[TXN, 'purged_record']]);
    expect(await c.replicas[0]!.projections.getRecord(c.fold, TXN)).toBeUndefined();

    const attention = buildNeedsAttention(createRepair(ledgerRepairRules).run(await c.replicas[0]!.projections.listRecords(c.fold)), quarantined);
    expect(attention).toEqual([{ kind: 'quarantined_op', ref: quarantined[0]!.sealed.op, messageKey: 'attention.quarantined.purged_record' }]);
  });

  it('a restore that raced the purge is refused the same way', async () => {
    const c = await twoDevices();
    c.setOffline(1, true);
    await deleteOn(c, 0);
    await c.sync(0);
    c.setOffline(1, false);
    await c.sync(1);
    c.setOffline(1, true);
    clockTo(c, T0 + 29 * DAY);
    await deleteOn(c, 1, TXN, false); // restored on day 29 by B's clock, while offline

    clockTo(c, T0 + RETENTION_MS + 1);
    await purge(c, 0, T0 + RETENTION_MS + 1);
    c.setOffline(1, false);
    await c.sync(1);
    await c.sync(0);
    expect((await c.replicas[0]!.oplog.listQuarantined(c.fold)).map((q) => q.reason)).toEqual(['purged_record']);
    expect((await ledgerOf(c, 0)).transactions.has(TXN)).toBe(false);
  });
});
