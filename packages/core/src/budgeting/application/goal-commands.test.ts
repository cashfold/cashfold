import { beforeEach, describe, expect, it } from 'vitest';
import { createRepair } from '../../sync/application/repair';
import { LedgerFixture, date, id, ledgerHarness, type LedgerHarness } from '../../testing/index';
import { createRateCommands } from '../../ledger/application/rate-commands';
import { createAccountCommands } from '../../ledger/application/account-commands';
import { createTransactionCommands } from '../../ledger/application/transaction-commands';
import { createTransferCommands } from '../../ledger/application/transfer-commands';
import { createLedgerViews } from '../../ledger/application/views';
import { createEventBus } from '../../sync/application/buses';
import { TABLE } from '../../ledger/domain/tables';
import { goalFieldPatch } from '../domain/goal';
import { createGoalCommands } from './goal-commands';
import { buildGoals, createGoalQueries } from './goal-queries';
import { budgetingRepairRules } from './repair-rules';

const goals = createGoalCommands();
let h: LedgerHarness;
const NOON = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12);
const base = { fold: undefined as never, id: id(80), name: 'Holiday', targetMinor: 600_000n, currency: 'USD', targetLocalDate: date(2027, 1, 15), accountId: id(3) };

beforeEach(async () => {
  h = await ledgerHarness();
  h.setNow(NOON(2026, 1, 15));
  const accounts = createAccountCommands();
  await h.run(accounts.createAccountRecord, { fold: h.fold, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 500_000n, openingDate: date(2020, 1, 1) });
  await h.run(accounts.createAccountRecord, { fold: h.fold, id: id(3), kind: 'goal', name: 'Holiday fund', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2020, 1, 1) });
  await h.run(accounts.createAccountRecord, { fold: h.fold, id: id(4), kind: 'goal', name: 'Car fund', currency: 'EUR', openingBalanceMinor: 0n, openingDate: date(2020, 1, 1) });
});

const records = () => h.replica.projections.listRecords(h.fold);

describe('goal commands', () => {
  it('creates, edits and deletes a goal', async () => {
    expect((await h.run(goals.addGoal, { ...base, fold: h.fold })).ok).toBe(true);
    expect((await h.run(goals.updateGoal, { fold: h.fold, id: id(80), changes: { targetMinor: 700_000n, name: 'Trip' } }))).toMatchObject({ ok: true });
    expect(buildGoals(await records()).get(id(80))).toMatchObject({ name: 'Trip', targetMinor: 700_000n, accountId: id(3) });
    expect(await h.run(goals.deleteGoal, { fold: h.fold, id: id(80) })).toMatchObject({ ok: true });
    expect(buildGoals(await records()).size).toBe(0);
    expect(await h.run(goals.deleteGoal, { fold: h.fold, id: id(80) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('refuses a target of zero, an existing id and an unknown account', async () => {
    expect(await h.run(goals.addGoal, { ...base, fold: h.fold, targetMinor: 0n })).toMatchObject({ ok: false, error: { code: 'invalid_target' } });
    await h.run(goals.addGoal, { ...base, fold: h.fold });
    expect(await h.run(goals.addGoal, { ...base, fold: h.fold })).toMatchObject({ ok: false, error: { code: 'goal_exists' } });
    expect(await h.run(goals.addGoal, { ...base, fold: h.fold, id: id(81), accountId: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('needs a goal account, and gives each goal account one goal', async () => {
    expect(await h.run(goals.addGoal, { ...base, fold: h.fold, accountId: id(1) })).toMatchObject({ ok: false, error: { code: 'not_a_goal_account' } });
    await h.run(goals.addGoal, { ...base, fold: h.fold });
    expect(await h.run(goals.addGoal, { ...base, fold: h.fold, id: id(81) })).toMatchObject({ ok: false, error: { code: 'account_has_goal' } });
    await h.run(goals.addGoal, { ...base, fold: h.fold, id: id(82), accountId: id(4), currency: 'EUR' });
    expect(await h.run(goals.updateGoal, { fold: h.fold, id: id(82), changes: { accountId: id(3) } })).toMatchObject({ ok: false, error: { code: 'account_has_goal' } });
    expect(await h.run(goals.updateGoal, { fold: h.fold, id: id(80), changes: { accountId: id(3) } })).toMatchObject({ ok: true });
  });

  it('a goal account takes transfers and adjustments only (FR-029)', async () => {
    const tx = createTransactionCommands({ clock: { nowMs: () => h.clock.now } });
    const spend = await h.run(tx.addTransaction, { fold: h.fold, id: id(90), accountId: id(3), direction: 'expense', amountMinor: -100n, currency: 'USD', occurredUtcMs: NOON(2026, 1, 10), tzOffsetMin: 0 });
    expect(spend).toMatchObject({ ok: false, error: { code: 'goal_entries_restricted' } });
    const xfer = createTransferCommands({ clock: { nowMs: () => h.clock.now } });
    expect((await h.run(xfer.addTransfer, { fold: h.fold, id: id(91), fromAccountId: id(1), toAccountId: id(3), fromAmountMinor: 100n, toAmountMinor: 100n, occurredUtcMs: NOON(2026, 1, 10), tzOffsetMin: 0 })).ok).toBe(true);
  });

  it('a viewer cannot change goals', async () => {
    h.setRole('viewer');
    expect((await h.run(goals.addGoal, { ...base, fold: h.fold })).ok).toBe(false);
  });
});

describe('goalProgress query', () => {
  const ask = async (today = date(2026, 1, 15)) => {
    const views = createLedgerViews(createEventBus());
    const queries = createGoalQueries({ views, clock: { nowMs: () => h.clock.now } });
    return h.ask(queries.goalProgress, { fold: h.fold, today });
  };

  it('shows saved, remaining, percent and the monthly saving after a transfer in', async () => {
    await h.run(goals.addGoal, { ...base, fold: h.fold });
    const xfer = createTransferCommands({ clock: { nowMs: () => h.clock.now } });
    await h.run(xfer.addTransfer, { fold: h.fold, id: id(91), fromAccountId: id(1), toAccountId: id(3), fromAmountMinor: 100_000n, toAmountMinor: 100_000n, occurredUtcMs: NOON(2026, 1, 15), tzOffsetMin: 0 });
    const r = await ask();
    expect(r).toMatchObject({ ok: true, value: [{ accountName: 'Holiday fund', progress: { savedMinor: 100_000n, remainingMinor: 500_000n, status: 'active', monthsLeft: 12, requiredPerMonthMinor: 41_667n } }] });
  });

  it('converts a goal account in another currency into the goal currency with the known rate, and says when there is none', async () => {
    await h.run(goals.addGoal, { ...base, fold: h.fold, id: id(82), accountId: id(4), currency: 'USD' });
    expect(await ask()).toMatchObject({ ok: true, value: [{ progress: undefined, missingRates: ['EUR'] }] });
    await h.run(createRateCommands().setCustomRate, { fold: h.fold, id: id(70), quote: 'EUR', asOfUtcS: Date.UTC(2026, 0, 1) / 1000, rateE12: 800_000_000_000n });
    const xfer = createTransferCommands({ clock: { nowMs: () => h.clock.now } });
    await h.run(xfer.addTransfer, { fold: h.fold, id: id(91), fromAccountId: id(1), toAccountId: id(4), fromAmountMinor: 6_250n, toAmountMinor: 5_000n, occurredUtcMs: NOON(2026, 1, 15), tzOffsetMin: 0 });
    const r = await ask();
    expect(r).toMatchObject({ ok: true, value: [{ progress: { savedMinor: 6_250n, remainingMinor: 593_750n }, missingRates: [] }] });
  });

  it('is empty without goals, and deleting the account takes its goal with it', async () => {
    expect(await ask()).toEqual({ ok: true, value: [] });
    await h.run(goals.addGoal, { ...base, fold: h.fold });
    expect(((await ask()) as { value: unknown[] }).value).toHaveLength(1);
    await h.run(createAccountCommands().deleteLedgerAccount, { fold: h.fold, id: id(3), confirm: true });
    expect(await ask()).toEqual({ ok: true, value: [] });
  });

  it('shows no progress for a goal whose account vanished in a merge', async () => {
    const f = new LedgerFixture();
    const pot = f.account({ kind: 'goal' });
    f.apply(id(5), TABLE.goal, goalFieldPatch({ name: 'G', targetMinor: 10n, currency: 'USD' as never, targetLocalDate: date(2027, 1, 1), accountId: pot, icon: null, color: 0 }));
    f.remove(pot, TABLE.account);
    expect([...buildGoals(f.fold).values()].map((g) => g.accountId)).toEqual([pot]);
  });
});

describe('goal repair rules', () => {
  const run = (f: LedgerFixture) => createRepair(budgetingRepairRules).run(f.fold);
  const goalOn = (f: LedgerFixture, account: ReturnType<LedgerFixture['account']>, rec = f.nextId()) => {
    f.apply(rec, TABLE.goal, goalFieldPatch({ name: 'G', targetMinor: 10n, currency: 'USD' as never, targetLocalDate: date(2027, 1, 1), accountId: account, icon: null, color: 0 }));
    return rec;
  };

  it('flags a goal whose account is gone or not a goal account, and the later of two goals on one account', () => {
    const f = new LedgerFixture();
    const pot = f.account({ kind: 'goal' });
    const first = goalOn(f, pot, id(1));
    const second = goalOn(f, pot, id(2));
    const checking = f.account({ kind: 'checking' });
    const wrong = goalOn(f, checking, id(3));
    expect(run(f).findings.map((x) => [x.kind, x.ref])).toEqual([['goal_duplicate_account', second], ['goal_invalid', wrong]].sort());
    f.remove(pot, TABLE.account);
    expect(run(f).findings.map((x) => x.ref).sort()).toEqual([first, second, wrong].sort());
  });

  it('hides a malformed goal', () => {
    const f = new LedgerFixture();
    const rec = f.nextId();
    f.apply(rec, TABLE.goal, new Map([[1, 'no target']]));
    expect(run(f).hidden.has(rec)).toBe(true);
  });
});
