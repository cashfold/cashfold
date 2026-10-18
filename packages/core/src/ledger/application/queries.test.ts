import { describe, expect, it } from 'vitest';
import { createCommandBus, createEventBus, createQueryBus } from '../../sync/application/buses';
import { createReplica, createWorld, date, id } from '../../testing/index';
import { LEDGER_GROUPS } from '../domain/ledger-groups';
import { foldSettingsPatch, settingsRecordId } from '../../sharing/domain/fold';
import { createAccountCommands } from './account-commands';
import { createLedgerQueries } from './queries';
import { createTransactionCommands } from './transaction-commands';
import { createLedgerViews } from './views';
import { TABLE, TXN_FIELD } from '../domain/tables';

const FOLD = id(0xf0);
const OFF = { adjustmentsAsIncomeExpense: false, transfersAsIncomeExpense: false };

async function setup(role: 'owner' | 'viewer' = 'owner') {
  const world = await createWorld();
  world.addFold(FOLD);
  const replica = await createReplica(world, { device: id(0xa), groups: LEDGER_GROUPS, nowMs: 1_800_000_000_000 });
  const events = createEventBus();
  const deps = { writePath: replica.writePath, projections: replica.projections, events, roleOf: async () => role, isUnlocked: () => true };
  const settings = foldSettingsPatch({ name: 'Home', baseCurrency: 'USD' });
  await replica.writePath.submit({ fold: FOLD, rec: settingsRecordId(FOLD), table: settings.table, fields: settings.fields, sets: new Map() });
  const views = createLedgerViews(events);
  const queries = createLedgerQueries({ views, clock: { nowMs: () => 1_800_000_000_000 }, quarantined: (fold) => replica.oplog.listQuarantined(fold) });
  const commandBus = createCommandBus({ ...deps, roleOf: async () => 'owner' });
  return { replica, views, queries, commandBus, bus: createQueryBus(deps), accounts: createAccountCommands(), txns: createTransactionCommands({ clock: { nowMs: () => 1_800_000_000_000 } }) };
}

describe('ledger queries', () => {
  it('serve a viewer, and read the same numbers the commands produced', async () => {
    const s = await setup('viewer');
    await s.commandBus.execute(s.accounts.createAccountRecord, { fold: FOLD, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 5_000n, openingDate: date(2026, 1, 1) });
    await s.commandBus.execute(s.txns.addTransaction, { fold: FOLD, id: id(2), accountId: id(1), direction: 'expense', amountMinor: -1_250n, currency: 'USD', occurredUtcMs: Date.UTC(2026, 2, 1, 12), tzOffsetMin: 0 });
    const basics = await s.bus.execute(s.queries.ledgerBasics, { fold: FOLD });
    expect(basics.ok && basics.value.accounts.map((a) => [a.name, a.balanceMinor])).toEqual([['Main', 3_750n]]);
    expect(basics.ok && basics.value.baseCurrency).toBe('USD');
    const list = await s.bus.execute(s.queries.listTransactions, { fold: FOLD, page: { limit: 10, offset: 0 } });
    expect(list.ok && [list.value.count, list.value.items.map((t) => t.amountMinor)]).toEqual([1, [-1_250n]]);
  });

  it('serves everything on the dashboard from one snapshot that agrees with itself', async () => {
    const s = await setup();
    await s.commandBus.execute(s.accounts.createAccountRecord, { fold: FOLD, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 5_000n, openingDate: date(2026, 1, 1) });
    for (const [n, minor] of [[2, -1_000n], [3, -250n]] as const) {
      await s.commandBus.execute(s.txns.addTransaction, { fold: FOLD, id: id(n), accountId: id(1), direction: 'expense', amountMinor: minor, currency: 'USD', occurredUtcMs: Date.UTC(2026, 2, 1, 12), tzOffsetMin: 0 });
    }
    const r = await s.bus.execute(s.queries.dashboard, { fold: FOLD, period: { from: date(2026, 3, 1), to: date(2026, 3, 31) }, asOf: date(2026, 3, 31), options: OFF });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.netWorth.totalMinor).toBe(3_750n);
    expect(r.value.incomeExpense).toMatchObject({ incomeMinor: 0n, expenseMinor: 1_250n, netMinor: -1_250n });
    expect(r.value.spending.totalMinor).toBe(r.value.incomeExpense.expenseMinor);
    expect(r.value.trend.map((m) => m.expenseMinor)).toEqual([1_250n]);
  });

  it('see a change as soon as the command that made it has committed (the cache is dropped)', async () => {
    const s = await setup();
    await s.commandBus.execute(s.accounts.createAccountRecord, { fold: FOLD, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2026, 1, 1) });
    const first = await s.bus.execute(s.queries.accountBalance, { fold: FOLD, account: id(1) });
    expect(first).toEqual({ ok: true, value: 0n });
    await s.commandBus.execute(s.txns.addTransaction, { fold: FOLD, id: id(2), accountId: id(1), direction: 'income', amountMinor: 700n, currency: 'USD', occurredUtcMs: Date.UTC(2026, 2, 1, 12), tzOffsetMin: 0 });
    expect(await s.bus.execute(s.queries.accountBalance, { fold: FOLD, account: id(1) })).toEqual({ ok: true, value: 700n });
  });

  it('build the ledger once while nothing changes', async () => {
    const s = await setup();
    const spy = { calls: 0 };
    const reader = { getRecord: s.replica.projections.getRecord, listRecords: async (f: typeof FOLD) => (spy.calls++, s.replica.projections.listRecords(f)) };
    await s.views.get(FOLD, reader);
    await s.views.get(FOLD, reader);
    expect(spy.calls).toBe(1);
    s.views.invalidate(FOLD);
    await s.views.get(FOLD, reader);
    expect(spy.calls).toBe(2);
  });

  it('list what needs attention: repair findings and quarantined ops, without amounts or names', async () => {
    const s = await setup();
    await s.replica.writePath.submit({ fold: FOLD, rec: id(77), table: TABLE.transaction, sets: new Map(), fields: new Map([[TXN_FIELD.note, 'private']]) });
    const r = await s.bus.execute(s.queries.needsAttention, { fold: FOLD });
    expect(r).toEqual({ ok: true, value: [{ kind: 'malformed_record', ref: id(77), messageKey: 'attention.malformed_record' }] });
  });

  it('list recently deleted transactions with the days left', async () => {
    const s = await setup();
    await s.commandBus.execute(s.accounts.createAccountRecord, { fold: FOLD, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2026, 1, 1) });
    await s.commandBus.execute(s.txns.addTransaction, { fold: FOLD, id: id(2), accountId: id(1), direction: 'income', amountMinor: 700n, currency: 'USD', occurredUtcMs: Date.UTC(2026, 2, 1, 12), tzOffsetMin: 0 });
    await s.commandBus.execute(s.txns.deleteTransaction, { fold: FOLD, id: id(2) });
    const r = await s.bus.execute(s.queries.recentlyDeleted, { fold: FOLD });
    expect(r.ok && r.value.map((d) => [d.transaction.id, d.daysLeft])).toEqual([[id(2), 30]]);
  });
});

describe('ledger queries: edges', () => {
  it('answers with the defaults when no filter, sort or page is given', async () => {
    const s = await setup();
    const r = await s.bus.execute(s.queries.listTransactions, { fold: FOLD });
    expect(r).toEqual({ ok: true, value: { items: [], count: 0 } });
  });

  it('says nothing for the balance of an unknown account and shows no balance that overflows', async () => {
    const s = await setup();
    expect(await s.bus.execute(s.queries.accountBalance, { fold: FOLD, account: id(404) })).toEqual({ ok: true, value: undefined });
    await s.replica.writePath.submit({
      fold: FOLD, rec: id(1), table: TABLE.account, sets: new Map(),
      fields: new Map<number, import('../../sync/domain/merge').FieldValue>([[1, 1n], [2, 'Big'], [3, 'USD'], [4, 2n ** 63n - 1n], [5, 20_260_101n]]),
    });
    await s.replica.writePath.submit({
      fold: FOLD, rec: id(2), table: TABLE.transaction, sets: new Map(),
      fields: new Map<number, import('../../sync/domain/merge').FieldValue>([[1, id(1)], [2, 2n], [3, 5n], [4, 'USD'], [5, 5n], [6, 'USD'], [7, null], [25, null], [10, 20_260_301n]]),
    });
    s.views.invalidate(FOLD); // these records were written around the command bus, which would have said so
    const basics = await s.bus.execute(s.queries.ledgerBasics, { fold: FOLD });
    expect(basics.ok && basics.value.accounts.map((a) => a.balanceMinor)).toEqual([null]);
  });

  it('serves the report queries', async () => {
    const s = await setup();
    const period = { from: date(2026, 1, 1), to: date(2026, 1, 31) };
    expect((await s.bus.execute(s.queries.spendingByCategory, { fold: FOLD, period, options: OFF })).ok).toBe(true);
    expect((await s.bus.execute(s.queries.spendingByCategory, { fold: FOLD, period, options: OFF, rollUp: true })).ok).toBe(true);
    expect((await s.bus.execute(s.queries.incomeVsExpense, { fold: FOLD, period, options: OFF })).ok).toBe(true);
    expect((await s.bus.execute(s.queries.netWorth, { fold: FOLD, asOf: date(2026, 1, 31) })).ok).toBe(true);
    expect(await s.bus.execute(s.queries.dayEndBalances, { fold: FOLD, account: id(404), range: period })).toMatchObject({ ok: true, value: { ok: false } });
  });

  it('sorts accounts, groups, categories, payees and tags in a stable order', async () => {
    const s = await setup();
    const submit = (rec: number, table: number, fields: Array<[number, import('../../sync/domain/merge').FieldValue]>) =>
      s.replica.writePath.submit({ fold: FOLD, rec: id(rec), table, sets: new Map(), fields: new Map(fields) });
    await submit(80, TABLE.payee, [[1, 'B']]);
    await submit(81, TABLE.payee, [[1, 'A']]);
    await submit(82, TABLE.payee, [[1, 'A']]);
    await submit(60, TABLE.category, [[1, 2n], [2, null], [3, 'Pay']]);
    await submit(61, TABLE.category, [[1, 1n], [2, null], [3, 'Food']]);
    const basics = await s.bus.execute(s.queries.ledgerBasics, { fold: FOLD });
    expect(basics.ok && basics.value.payees.map((p) => p.id)).toEqual([id(81), id(82), id(80)]);
    expect(basics.ok && basics.value.categories.map((c) => c.id)).toEqual([id(61), id(60)]);
  });
});
