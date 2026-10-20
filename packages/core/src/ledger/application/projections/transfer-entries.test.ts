import { describe, expect, it } from 'vitest';
import { LedgerFixture, date, id } from '../../../testing/index';
import { TABLE, TRANSFER_FIELD } from '../../domain/tables';
import { accountBalance } from '../balance';
import { dayEndBalances, incomeVsExpense, netWorth, spendingByCategory, type ReportOptions } from '../queries/reports';
import { buildLedger } from './ledger';

const OFF: ReportOptions = { adjustmentsAsIncomeExpense: false, transfersAsIncomeExpense: false };
const ON: ReportOptions = { ...OFF, transfersAsIncomeExpense: true };
const JAN = { from: date(2026, 1, 1), to: date(2026, 1, 31) };
const E12 = 10n ** 12n;
const bal = (f: LedgerFixture, a: ReturnType<LedgerFixture['account']>, asOf?: ReturnType<typeof date>) => {
  const r = accountBalance(buildLedger(f.fold), a, asOf);
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};

function world() {
  const f = new LedgerFixture('USD');
  const usd = f.account({ name: 'Checking', openingBalanceMinor: 100_000n, openingDate: date(2025, 1, 1) });
  const eur = f.account({ name: 'Euro', currency: 'EUR' as never, openingBalanceMinor: 0n, openingDate: date(2025, 1, 1) });
  const usd2 = f.account({ name: 'Savings', openingBalanceMinor: 0n, openingDate: date(2025, 1, 1) });
  return { f, usd, eur, usd2 };
}

describe('a transfer is two ledger entries', () => {
  it('takes money out of one account and puts it into the other, each in its own currency', () => {
    const { f, usd, eur } = world();
    f.transfer(usd, eur, { from: 10_000n, to: 9_137n });
    expect(bal(f, usd)).toBe(90_000n);
    expect(bal(f, eur)).toBe(9_137n);
    const legs = buildLedger(f.fold).entries.filter((e) => e.leg !== 'single').map((e) => [e.leg, e.amountMinor]);
    expect(legs).toEqual(expect.arrayContaining([['out', -10_000n], ['in', 9_137n]]));
  });

  it('moves the same amount between same-currency accounts, so the total is unchanged', () => {
    const { f, usd, usd2 } = world();
    f.transfer(usd, usd2, { from: 25_000n });
    expect(bal(f, usd) + bal(f, usd2)).toBe(100_000n);
  });

  it('counts only posted transfers, up to the date asked for', () => {
    const { f, usd, usd2 } = world();
    f.transfer(usd, usd2, { from: 1_000n, localDate: date(2026, 1, 10) });
    f.transfer(usd, usd2, { from: 2_000n, status: 'pending', localDate: date(2026, 1, 11) });
    f.transfer(usd, usd2, { from: 4_000n, status: 'void', localDate: date(2026, 1, 12) });
    f.transfer(usd, usd2, { from: 8_000n, localDate: date(2026, 2, 1) });
    expect(bal(f, usd2, date(2026, 1, 31))).toBe(1_000n);
    expect(bal(f, usd2)).toBe(9_000n);
  });

  it('deleting a transfer takes away both sides, and restoring brings both back', () => {
    const { f, usd, usd2 } = world();
    const t = f.transfer(usd, usd2, { from: 5_000n });
    f.remove(t, TABLE.transfer);
    expect([bal(f, usd), bal(f, usd2)]).toEqual([100_000n, 0n]);
    expect(buildLedger(f.fold).deletedTransfers.has(t)).toBe(true);
    f.restore(t, TABLE.transfer);
    expect([bal(f, usd), bal(f, usd2)]).toEqual([95_000n, 5_000n]);
  });

  it('keeps amounts above 2^53 exact', () => {
    const { f, usd, usd2 } = world();
    const big = 2n ** 58n + 3n;
    f.transfer(usd, usd2, { from: big });
    expect(bal(f, usd2)).toBe(big);
    expect(bal(f, usd)).toBe(100_000n - big);
  });

  it('shows in the day-end balances of both accounts', () => {
    const { f, usd, usd2 } = world();
    f.transfer(usd, usd2, { from: 1_000n, localDate: date(2026, 1, 3) });
    const r = dayEndBalances(buildLedger(f.fold), usd2, { from: date(2026, 1, 2), to: date(2026, 1, 4) });
    expect(r.ok && r.value.map((d) => d.balanceMinor)).toEqual([0n, 1_000n, 1_000n]);
  });

  it('does not change net worth when both accounts count', () => {
    const { f, usd, usd2 } = world();
    f.transfer(usd, usd2, { from: 1_000n });
    expect(netWorth(buildLedger(f.fold), date(2026, 1, 31)).totalMinor).toBe(100_000n);
  });
});

describe('transfers in income and expense reports (FR-046)', () => {
  it('are left out by default and counted when the toggle is on', () => {
    const { f, usd, usd2 } = world();
    f.transfer(usd, usd2, { from: 1_000n, localDate: date(2026, 1, 5) });
    const l = buildLedger(f.fold);
    expect(incomeVsExpense(l, JAN, OFF)).toMatchObject({ incomeMinor: 0n, expenseMinor: 0n });
    expect(incomeVsExpense(l, JAN, ON)).toMatchObject({ incomeMinor: 1_000n, expenseMinor: 1_000n, netMinor: 0n });
    expect(spendingByCategory(l, JAN, OFF).totalMinor).toBe(0n);
    const on = spendingByCategory(l, JAN, ON);
    expect(on.totalMinor).toBe(1_000n);
    expect(on.rows).toEqual([{ categoryId: null, amountMinor: 1_000n }]);
  });

  it('convert each side to the base currency at the rate of the day', () => {
    const { f, usd, eur } = world();
    f.exchangeRate({ quote: 'EUR' as never, asOfUtcS: 100, rateE12: ((9n * E12) / 10n) as never, source: 'service' });
    f.transfer(usd, eur, { from: 10_000n, to: 9_000n, localDate: date(2026, 1, 5) });
    expect(incomeVsExpense(buildLedger(f.fold), JAN, ON)).toMatchObject({ incomeMinor: 10_000n, expenseMinor: 10_000n, missingRates: [] });
  });

  it('name a currency with no rate instead of guessing', () => {
    const { f, usd, eur } = world();
    f.transfer(usd, eur, { from: 10_000n, to: 9_000n, localDate: date(2026, 1, 5) });
    const r = incomeVsExpense(buildLedger(f.fold), JAN, ON);
    expect(r).toMatchObject({ incomeMinor: 0n, expenseMinor: 10_000n, missingRates: ['EUR'] });
  });

  it('only count posted transfers inside the period', () => {
    const { f, usd, usd2 } = world();
    f.transfer(usd, usd2, { from: 1_000n, status: 'pending', localDate: date(2026, 1, 5) });
    f.transfer(usd, usd2, { from: 2_000n, localDate: date(2026, 2, 5) });
    expect(incomeVsExpense(buildLedger(f.fold), JAN, ON)).toMatchObject({ incomeMinor: 0n, expenseMinor: 0n });
  });
});

describe('a transfer record that cannot be read', () => {
  it('is ignored', () => {
    const { f, usd } = world();
    f.apply(id(77), TABLE.transfer, new Map([[TRANSFER_FIELD.fromAccountId, usd]]));
    expect(buildLedger(f.fold).transfers.size).toBe(0);
  });
});
