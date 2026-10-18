import { beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '../../../shared-kernel/id';
import { LedgerFixture, date, id } from '../../../testing/index';
import { LABEL_FIELD, TABLE } from '../../domain/tables';
import { buildLedger, type Ledger } from '../projections/ledger';
import {
  dayEndBalances, incomeVsExpense, monthlyTrend, netWorth, resolvePeriod, spendingByCategory, spendingByTag, type ReportOptions,
} from './reports';

const OFF: ReportOptions = { adjustmentsAsIncomeExpense: false, transfersAsIncomeExpense: false };
const JAN = { from: date(2026, 1, 1), to: date(2026, 1, 31) };
const E12 = 10n ** 12n;

interface Fx {
  f: LedgerFixture;
  usd: Id;
  eur: Id;
  food: Id;
  groceries: Id;
  fun: Id;
  salary: Id;
}

function fixture(): Fx {
  const f = new LedgerFixture();
  const usd = f.account({ name: 'Checking', currency: 'USD' as never, openingBalanceMinor: 100_000n, openingDate: date(2025, 1, 1) });
  const eur = f.account({ name: 'Euro', currency: 'EUR' as never, openingBalanceMinor: 50_000n, openingDate: date(2025, 1, 1) });
  const food = f.category({ name: 'Food' });
  const groceries = f.category({ name: 'Groceries', parentId: food });
  const fun = f.category({ name: 'Fun' });
  const salary = f.category({ name: 'Salary', direction: 'income' });
  return { f, usd, eur, food, groceries, fun, salary };
}

const at = (y: number, m: number, d: number) => ({ localDate: date(y, m, d), occurredUtcMs: Date.UTC(y, m - 1, d, 12) });

describe('spendingByCategory', () => {
  let x: Fx;
  let ledger: Ledger;
  beforeEach(() => {
    x = fixture();
    x.f.transaction(x.usd, { amountMinor: -1_000n, categoryId: x.groceries, ...at(2026, 1, 5) });
    x.f.transaction(x.usd, { amountMinor: -500n, categoryId: x.food, ...at(2026, 1, 6) });
    x.f.transaction(x.usd, { amountMinor: -250n, categoryId: x.fun, ...at(2026, 1, 7) });
    x.f.transaction(x.usd, { amountMinor: -75n, ...at(2026, 1, 8) }); // uncategorised
    x.f.transaction(x.usd, { amountMinor: -9_999n, categoryId: x.fun, ...at(2026, 2, 1) }); // outside the period
    x.f.transaction(x.usd, { amountMinor: -111n, categoryId: x.fun, status: 'pending', ...at(2026, 1, 9) });
    x.f.transaction(x.usd, { amountMinor: -222n, categoryId: x.fun, status: 'void', ...at(2026, 1, 9) });
    x.f.transaction(x.usd, { amountMinor: 300_000n, categoryId: x.salary, ...at(2026, 1, 25) });
    ledger = buildLedger(x.f.fold);
  });

  it('adds up posted expenses in the period by category, largest first, income excluded', () => {
    const r = spendingByCategory(ledger, JAN, OFF);
    expect(r.rows.map((row) => [row.categoryId, row.amountMinor])).toEqual([[x.groceries, 1_000n], [x.food, 500n], [x.fun, 250n], [null, 75n]]);
    expect(r.totalMinor).toBe(1_825n);
    expect(r.currency).toBe('USD');
  });

  it('rolls children up into their root category', () => {
    const r = spendingByCategory(ledger, JAN, OFF, { rollUp: true });
    expect(r.rows.map((row) => [row.categoryId, row.amountMinor])).toEqual([[x.food, 1_500n], [x.fun, 250n], [null, 75n]]);
    expect(r.totalMinor).toBe(1_825n);
  });

  it('lets a refund reduce the category it refunds', () => {
    x.f.transaction(x.usd, { amountMinor: 400n, direction: 'income', isRefund: true, categoryId: x.groceries, ...at(2026, 1, 10) });
    const r = spendingByCategory(buildLedger(x.f.fold), JAN, OFF);
    expect(r.rows.find((row) => row.categoryId === x.groceries)!.amountMinor).toBe(600n);
    expect(r.totalMinor).toBe(1_425n);
  });

  it('sums in the base currency using the amounts frozen at entry', () => {
    x.f.transaction(x.eur, { amountMinor: -1_000n, currency: 'EUR' as never, baseAmountMinor: -1_100n, categoryId: x.fun, ...at(2026, 1, 12) });
    const r = spendingByCategory(buildLedger(x.f.fold), JAN, OFF);
    expect(r.rows.find((row) => row.categoryId === x.fun)!.amountMinor).toBe(1_350n);
  });

  it('leaves adjustments out unless asked, and counts them as income or expense when asked', () => {
    x.f.transaction(x.usd, { amountMinor: -300n, direction: 'adjustment', ...at(2026, 1, 15) });
    x.f.transaction(x.usd, { amountMinor: 700n, direction: 'adjustment', ...at(2026, 1, 16) });
    const l = buildLedger(x.f.fold);
    expect(spendingByCategory(l, JAN, OFF).totalMinor).toBe(1_825n);
    const on = { ...OFF, adjustmentsAsIncomeExpense: true };
    expect(spendingByCategory(l, JAN, on).totalMinor).toBe(2_125n);
    expect(spendingByCategory(l, JAN, on).rows.find((row) => row.categoryId === null)!.amountMinor).toBe(375n);
  });

  it('matches the total of the incomeVsExpense report', () => {
    expect(incomeVsExpense(ledger, JAN, OFF).expenseMinor).toBe(spendingByCategory(ledger, JAN, OFF).totalMinor);
  });

  it('keeps amounts above 2^53 exact', () => {
    const big = 2n ** 55n;
    x.f.transaction(x.usd, { amountMinor: -big, categoryId: x.fun, ...at(2026, 1, 20) });
    expect(spendingByCategory(buildLedger(x.f.fold), JAN, OFF).totalMinor).toBe(1_825n + big);
  });
});

describe('spendingByTag', () => {
  it('counts a transaction towards each of its tags', () => {
    const x = fixture();
    const [a, b] = [id(900), id(901)];
    for (const [t, name] of [[a, 'fun'], [b, 'work']] as const) x.f.apply(t, TABLE.tag, new Map([[LABEL_FIELD.name, name]]));
    x.f.transaction(x.usd, { amountMinor: -100n, tagIds: [a, b], ...at(2026, 1, 5) });
    x.f.transaction(x.usd, { amountMinor: -50n, tagIds: [a], ...at(2026, 1, 6) });
    x.f.transaction(x.usd, { amountMinor: -7n, ...at(2026, 1, 6) });
    const r = spendingByTag(buildLedger(x.f.fold), JAN, OFF);
    expect(r.rows.map((row) => [row.tagId, row.amountMinor])).toEqual([[a, 150n], [b, 100n]]);
    expect(r.totalMinor).toBe(157n);
  });
});

describe('incomeVsExpense', () => {
  it('reports income, expense and the difference for a period', () => {
    const x = fixture();
    x.f.transaction(x.usd, { amountMinor: 300_000n, categoryId: x.salary, ...at(2026, 1, 25) });
    x.f.transaction(x.usd, { amountMinor: -1_000n, ...at(2026, 1, 5) });
    x.f.transaction(x.usd, { amountMinor: 200n, direction: 'income', isRefund: true, ...at(2026, 1, 6) });
    expect(incomeVsExpense(buildLedger(x.f.fold), JAN, OFF)).toEqual({ currency: 'USD', incomeMinor: 300_000n, expenseMinor: 800n, netMinor: 299_200n });
  });

  it('honours the adjustments option', () => {
    const x = fixture();
    x.f.transaction(x.usd, { amountMinor: 500n, direction: 'adjustment', ...at(2026, 1, 5) });
    x.f.transaction(x.usd, { amountMinor: -200n, direction: 'adjustment', ...at(2026, 1, 6) });
    const l = buildLedger(x.f.fold);
    expect(incomeVsExpense(l, JAN, OFF)).toMatchObject({ incomeMinor: 0n, expenseMinor: 0n });
    expect(incomeVsExpense(l, JAN, { ...OFF, adjustmentsAsIncomeExpense: true })).toMatchObject({ incomeMinor: 500n, expenseMinor: 200n, netMinor: 300n });
  });

  it('buckets a trend by month', () => {
    const x = fixture();
    x.f.transaction(x.usd, { amountMinor: -100n, ...at(2026, 1, 31) });
    x.f.transaction(x.usd, { amountMinor: -200n, ...at(2026, 2, 1) });
    x.f.transaction(x.usd, { amountMinor: 900n, ...at(2026, 3, 15) });
    const trend = monthlyTrend(buildLedger(x.f.fold), { from: date(2026, 1, 1), to: date(2026, 3, 31) }, OFF);
    expect(trend.map((b) => [b.month, b.incomeMinor, b.expenseMinor])).toEqual([[202_601, 0n, 100n], [202_602, 0n, 200n], [202_603, 900n, 0n]]);
  });
});

describe('netWorth', () => {
  it('adds up balances in the base currency at the rates in force on the date', () => {
    const x = fixture();
    x.f.exchangeRate({ quote: 'EUR' as never, asOfUtcS: 100, rateE12: (5n * E12) / 10n as never, source: 'service' }); // 0.5 EUR per USD
    const r = netWorth(buildLedger(x.f.fold), date(2026, 1, 31));
    // 1,000.00 USD + 500.00 EUR / 0.5 = 1,000.00 USD
    expect(r).toMatchObject({ currency: 'USD', totalMinor: 200_000n, missing: [] });
    expect(r.accounts.map((a) => [a.accountId, a.balanceMinor, a.baseMinor])).toEqual([[x.usd, 100_000n, 100_000n], [x.eur, 50_000n, 100_000n]]);
  });

  it('leaves out accounts excluded from net worth', () => {
    const x = fixture();
    x.f.exchangeRate({ quote: 'EUR' as never, asOfUtcS: 100, rateE12: E12 as never, source: 'service' });
    x.f.account({ name: 'Hidden', currency: 'USD' as never, openingBalanceMinor: 7_777n, includeInNetWorth: false });
    expect(netWorth(buildLedger(x.f.fold), date(2026, 1, 31)).totalMinor).toBe(150_000n);
  });

  it('names a currency it has no rate for instead of guessing, and still totals the rest', () => {
    const x = fixture();
    const r = netWorth(buildLedger(x.f.fold), date(2026, 1, 31));
    expect(r).toMatchObject({ totalMinor: 100_000n, missing: ['EUR'] });
  });

  it('is as of a date: later entries do not count', () => {
    const x = fixture();
    x.f.transaction(x.usd, { amountMinor: -40_000n, ...at(2026, 2, 10) });
    x.f.exchangeRate({ quote: 'EUR' as never, asOfUtcS: 100, rateE12: E12 as never, source: 'service' });
    const l = buildLedger(x.f.fold);
    expect(netWorth(l, date(2026, 1, 31)).totalMinor).toBe(150_000n);
    expect(netWorth(l, date(2026, 2, 28)).totalMinor).toBe(110_000n);
  });

  it('refuses to guess a base currency', () => {
    const l = buildLedger(fixture().f.fold);
    expect(netWorth({ ...l, baseCurrency: undefined }, date(2026, 1, 31))).toMatchObject({ currency: undefined, totalMinor: null });
  });
});

describe('dayEndBalances', () => {
  it('gives the balance at the end of each day, carrying it over quiet days', () => {
    const x = fixture();
    x.f.transaction(x.usd, { amountMinor: -1_000n, ...at(2026, 1, 2) });
    x.f.transaction(x.usd, { amountMinor: -500n, ...at(2026, 1, 2) });
    x.f.transaction(x.usd, { amountMinor: 2_000n, ...at(2026, 1, 4) });
    x.f.transaction(x.usd, { amountMinor: 9n, status: 'pending', ...at(2026, 1, 3) });
    const r = dayEndBalances(buildLedger(x.f.fold), x.usd, { from: date(2026, 1, 1), to: date(2026, 1, 5) });
    expect(r).toEqual({ ok: true, value: [
      { date: 20_260_101, balanceMinor: 100_000n }, { date: 20_260_102, balanceMinor: 98_500n }, { date: 20_260_103, balanceMinor: 98_500n },
      { date: 20_260_104, balanceMinor: 100_500n }, { date: 20_260_105, balanceMinor: 100_500n },
    ] });
  });

  it('starts from the balance before the range', () => {
    const x = fixture();
    x.f.transaction(x.usd, { amountMinor: -1_000n, ...at(2025, 12, 31) });
    const r = dayEndBalances(buildLedger(x.f.fold), x.usd, { from: date(2026, 1, 1), to: date(2026, 1, 1) });
    expect(r).toEqual({ ok: true, value: [{ date: 20_260_101, balanceMinor: 99_000n }] });
  });

  it('refuses an unknown account, an inverted range and an absurdly long one', () => {
    const l = buildLedger(fixture().f.fold);
    expect(dayEndBalances(l, id(404), JAN)).toMatchObject({ ok: false, error: { code: 'unknown_account' } });
    expect(dayEndBalances(l, [...l.accounts.keys()][0]!, { from: date(2026, 2, 1), to: date(2026, 1, 1) })).toMatchObject({ ok: false, error: { code: 'invalid_range' } });
    expect(dayEndBalances(l, [...l.accounts.keys()][0]!, { from: date(1990, 1, 1), to: date(2026, 1, 1) })).toMatchObject({ ok: false, error: { code: 'invalid_range' } });
  });
});

describe('resolvePeriod', () => {
  const today = date(2026, 3, 15);
  it('resolves the dashboard presets', () => {
    expect(resolvePeriod({ kind: 'this_month' }, today)).toEqual({ from: 20_260_301, to: 20_260_331 });
    expect(resolvePeriod({ kind: 'last_month' }, today)).toEqual({ from: 20_260_201, to: 20_260_228 });
    expect(resolvePeriod({ kind: 'this_year' }, today)).toEqual({ from: 20_260_101, to: 20_261_231 });
    expect(resolvePeriod({ kind: 'last_days', days: 30 }, today)).toEqual({ from: 20_260_214, to: 20_260_315 });
    expect(resolvePeriod({ kind: 'all_time' }, today)).toEqual({ from: 10_101, to: 99_991_231 });
    expect(resolvePeriod({ kind: 'custom', from: date(2026, 1, 5), to: date(2026, 1, 9) }, today)).toEqual({ from: 20_260_105, to: 20_260_109 });
  });

  it('rolls January back into last December', () => {
    expect(resolvePeriod({ kind: 'last_month' }, date(2026, 1, 10))).toEqual({ from: 20_251_201, to: 20_251_231 });
  });

  it('swaps a custom range given the wrong way round', () => {
    expect(resolvePeriod({ kind: 'custom', from: date(2026, 1, 9), to: date(2026, 1, 5) }, today)).toEqual({ from: 20_260_105, to: 20_260_109 });
  });
});

describe('reports: edge cases', () => {
  it('nets worth in a non-USD base currency from a USD account via the pivot, and from the base currency itself', () => {
    const f = new LedgerFixture('EUR');
    f.account({ name: 'Dollars', currency: 'USD' as never, openingBalanceMinor: 10_000n });
    f.account({ name: 'Euros', currency: 'EUR' as never, openingBalanceMinor: 500n });
    f.exchangeRate({ quote: 'EUR' as never, asOfUtcS: 100, rateE12: (9n * E12) / 10n as never, source: 'service' });
    const r = netWorth(buildLedger(f.fold), date(2026, 1, 31));
    expect(r.accounts.map((a) => a.baseMinor)).toEqual([9_000n, 500n]);
    expect(r.totalMinor).toBe(9_500n);
  });

  it('names the base currency when only its rate is missing', () => {
    const f = new LedgerFixture('GBP');
    f.account({ currency: 'USD' as never, openingBalanceMinor: 100n });
    expect(netWorth(buildLedger(f.fold), date(2026, 1, 31))).toMatchObject({ totalMinor: 0n, missing: ['GBP'] });
  });

  it('gives no total when a balance does not fit in 64 bits', () => {
    const f = new LedgerFixture();
    const a = f.account({ openingBalanceMinor: 2n ** 63n - 1n });
    f.transaction(a, { amountMinor: 5n });
    expect(netWorth(buildLedger(f.fold), date(2026, 1, 31)).totalMinor).toBeNull();
  });

  it('gives no total when a conversion overflows', () => {
    const f = new LedgerFixture();
    f.account({ currency: 'EUR' as never, openingBalanceMinor: 2n ** 62n });
    f.exchangeRate({ quote: 'EUR' as never, asOfUtcS: 100, rateE12: 1n as never, source: 'service' });
    expect(netWorth(buildLedger(f.fold), date(2026, 1, 31)).totalMinor).toBeNull();
  });

  it('orders accounts by position, then name, then id', () => {
    const f = new LedgerFixture();
    f.account({ name: 'B', sortOrder: 1 }, id(1));
    f.account({ name: 'A', sortOrder: 1 }, id(2));
    f.account({ name: 'A', sortOrder: 1 }, id(0));
    f.account({ name: 'Z', sortOrder: 0 }, id(3));
    expect(netWorth(buildLedger(f.fold), date(2026, 1, 31)).accounts.map((a) => a.accountId)).toEqual([id(3), id(0), id(2), id(1)]);
  });

  it('breaks ties between equal spending rows by id', () => {
    const f = new LedgerFixture();
    const a = f.account();
    const c1 = f.category({ name: 'One' }, id(11));
    const c2 = f.category({ name: 'Two' }, id(12));
    f.transaction(a, { amountMinor: -5n, categoryId: c2, ...at(2026, 1, 5) });
    f.transaction(a, { amountMinor: -5n, categoryId: c1, ...at(2026, 1, 5) });
    expect(spendingByCategory(buildLedger(f.fold), JAN, OFF).rows.map((r) => r.categoryId)).toEqual([c1, c2]);
  });

  it('skips transactions that move no money (a zero base amount)', () => {
    const f = new LedgerFixture();
    const a = f.account();
    f.transaction(a, { amountMinor: -5n, baseAmountMinor: 0n, ...at(2026, 1, 5) });
    expect(spendingByCategory(buildLedger(f.fold), JAN, OFF)).toMatchObject({ rows: [], totalMinor: 0n });
    expect(spendingByTag(buildLedger(f.fold), JAN, OFF).rows).toEqual([]);
  });

  it('day-end balances refuse a start balance or a running balance outside 64 bits', () => {
    const f = new LedgerFixture();
    const a = f.account({ openingBalanceMinor: 2n ** 63n - 1n });
    f.transaction(a, { amountMinor: 5n, ...at(2026, 1, 3) });
    const l = buildLedger(f.fold);
    expect(dayEndBalances(l, a, { from: date(2026, 1, 1), to: date(2026, 1, 5) })).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
    expect(dayEndBalances(l, a, { from: date(2026, 1, 4), to: date(2026, 1, 5) })).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
  });

  it('day-end balances ignore entries of other accounts and outside the range', () => {
    const f = new LedgerFixture();
    const a = f.account({ openingBalanceMinor: 100n });
    const b = f.account({ openingBalanceMinor: 0n });
    f.transaction(b, { amountMinor: 9n, ...at(2026, 1, 2) });
    f.transaction(a, { amountMinor: 5n, ...at(2026, 1, 9) });
    const r = dayEndBalances(buildLedger(f.fold), a, { from: date(2026, 1, 1), to: date(2026, 1, 3) });
    expect(r.ok && r.value.map((d) => d.balanceMinor)).toEqual([100n, 100n, 100n]);
  });
});
