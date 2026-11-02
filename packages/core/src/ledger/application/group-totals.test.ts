import { describe, expect, it } from 'vitest';
import type { CurrencyCode } from '../../shared-kernel/currency';
import { convert } from '../../shared-kernel/fx';
import { money } from '../../shared-kernel/money';
import { LedgerFixture, date, id } from '../../testing/index';
import { nearestPrior, type ExchangeRate } from '../domain/exchange-rate';
import { groupBalances, type GroupBalanceAccount } from './group-totals';
import { buildLedger } from './projections/ledger';
import { endOfDayUtcS, netWorth } from './queries/reports';

const E12 = 10n ** 12n;
const cur = (c: string) => c as CurrencyCode;
const NOW = 1_000_000;
const rate = (quote: string, rateE12: bigint, asOfUtcS = 100, n = 1): ExchangeRate => ({ id: id(900 + n), quote: quote as never, asOfUtcS, rateE12: rateE12 as never, source: 'service' });
const acct = (n: number, currency: string, balanceMinor: bigint | null): GroupBalanceAccount => ({ id: id(n), currency: cur(currency), balanceMinor });
const run = (accounts: GroupBalanceAccount[], groupCurrency: string, rates: ExchangeRate[]) => groupBalances({ accounts, groupCurrency: cur(groupCurrency), rates, asOfUtcS: NOW });
const EUR = rate('EUR', (9n * E12) / 10n, 100, 1); // 0.9 EUR per USD
const PLN = rate('PLN', 4n * E12, 100, 2); // 4 PLN per USD

describe('groupBalances', () => {
  it('is the plain sum when every account is in the group currency, and uses no rate', () => {
    const r = run([acct(1, 'EUR', 10_000n), acct(2, 'EUR', -2_500n)], 'EUR', []);
    expect(r).toMatchObject({ subtotalMinor: 7_500n, missing: [], overflow: false });
    expect(r.rows).toEqual([{ id: id(1), convertedMinor: 10_000n, rateAsOf: null }, { id: id(2), convertedMinor: -2_500n, rateAsOf: null }]);
  });

  it('converts foreign accounts with the rate in force at the end of the day, and sums the figures shown', () => {
    const accounts = [acct(1, 'EUR', 10_000n), acct(2, 'USD', 5_000n), acct(3, 'PLN', 20_000n)];
    const r = run(accounts, 'EUR', [EUR, PLN]);
    const expected = (a: GroupBalanceAccount, from: bigint, to: bigint) => {
      const m = money(a.balanceMinor!, a.currency);
      if (!m.ok) throw new Error('money');
      const c = convert(m.value, cur('EUR'), from as never, to as never);
      if (!c.ok) throw new Error('convert');
      return c.value.minor;
    };
    const usd = expected(accounts[1]!, E12, EUR.rateE12);
    const pln = expected(accounts[2]!, PLN.rateE12, EUR.rateE12);
    expect(usd).toBe(4_500n);
    expect(pln).toBe(4_500n);
    expect(r.rows.map((x) => x.convertedMinor)).toEqual([10_000n, usd, pln]);
    expect(r.subtotalMinor).toBe(10_000n + usd + pln);
    expect(r.rows.map((x) => x.rateAsOf)).toEqual([null, 100, 100]);
  });

  it('uses USD as the pivot in both directions', () => {
    expect(run([acct(1, 'USD', 10_000n)], 'EUR', [EUR]).subtotalMinor).toBe(9_000n);
    expect(run([acct(1, 'EUR', 9_000n)], 'USD', [EUR]).subtotalMinor).toBe(10_000n);
  });

  it('converts an account in a currency that is neither the pivot nor the group', () => {
    expect(run([acct(1, 'PLN', 4_000n)], 'EUR', [EUR, PLN]).subtotalMinor).toBe(900n);
  });

  it('keeps the sign of a negative balance and skips an unknown one', () => {
    const r = run([acct(1, 'USD', -5_000n), acct(2, 'USD', null)], 'EUR', [EUR]);
    expect(r.subtotalMinor).toBe(-4_500n);
    expect(r.rows).toHaveLength(1);
  });

  it('takes the latest rate dated on or before the day, and reports its date', () => {
    const r = run([acct(1, 'USD', 10_000n)], 'EUR', [rate('EUR', 2n * E12, 50, 1), rate('EUR', E12, 200, 2), rate('EUR', 3n * E12, NOW + 1, 3)]);
    expect(r.subtotalMinor).toBe(10_000n);
    expect(r.rows[0]!.rateAsOf).toBe(200);
  });

  it('reports the older of the two rates used', () => {
    const r = run([acct(1, 'PLN', 4_000n)], 'EUR', [rate('EUR', E12, 300, 1), rate('PLN', E12, 120, 2)]);
    expect(r.rows[0]!.rateAsOf).toBe(120);
  });

  it('sets overflow and gives that account no figure when a result is out of range', () => {
    const r = run([acct(1, 'USD', 9_000_000_000_000_000_000n), acct(2, 'EUR', 100n)], 'EUR', [rate('EUR', 10n * E12, 100, 1)]);
    expect(r.overflow).toBe(true);
    expect(r.rows[0]!.convertedMinor).toBeNull();
    expect(r.subtotalMinor).toBe(100n);
  });

  it('gives the same result whatever the order of the accounts', () => {
    const accounts = [acct(1, 'EUR', 10_000n), acct(2, 'USD', 5_001n), acct(3, 'PLN', 20_003n)];
    const a = run(accounts, 'EUR', [EUR, PLN]);
    const b = run([...accounts].reverse(), 'EUR', [PLN, EUR]);
    expect(b.subtotalMinor).toBe(a.subtotalMinor);
    expect([...b.rows].sort((x, y) => (x.id < y.id ? -1 : 1))).toEqual(a.rows);
  });

  it("equals the Overview's net worth when the group currency is the base currency", () => {
    const f = new LedgerFixture();
    const usd = f.account({ name: 'A', currency: 'USD' as never, openingBalanceMinor: 123_457n, openingDate: date(2025, 1, 1) });
    const eur = f.account({ name: 'B', currency: 'EUR' as never, openingBalanceMinor: 98_765n, openingDate: date(2025, 1, 1) });
    const pln = f.account({ name: 'C', currency: 'PLN' as never, openingBalanceMinor: -33_333n, openingDate: date(2025, 1, 1) });
    f.exchangeRate({ quote: 'EUR' as never, asOfUtcS: 100, rateE12: 918_273_645_000n as never, source: 'service' });
    f.exchangeRate({ quote: 'PLN' as never, asOfUtcS: 100, rateE12: 3_912_345_678_901n as never, source: 'service' });
    const ledger = buildLedger(f.fold);
    const day = date(2026, 1, 31);
    const worth = netWorth(ledger, day);
    const accounts = [usd, eur, pln].map((accountId) => {
      const a = ledger.accounts.get(accountId)!;
      return { id: a.id, currency: a.currency, balanceMinor: worth.accounts.find((x) => x.accountId === accountId)!.balanceMinor };
    });
    const r = groupBalances({ accounts, groupCurrency: ledger.baseCurrency!, rates: ledger.rates, asOfUtcS: endOfDayUtcS(day) });
    expect(r.subtotalMinor).toBe(worth.totalMinor);
    expect(r.rows.map((x) => x.convertedMinor)).toEqual(worth.accounts.map((x) => x.baseMinor));
    expect(nearestPrior(ledger.rates, 'EUR', endOfDayUtcS(day))).toBeDefined();
  });
});

describe('groupBalances: a missing rate', () => {
  it('leaves the account out, names its currency, and totals the rest', () => {
    const r = run([acct(1, 'EUR', 10_000n), acct(2, 'GBP', 5_000n)], 'EUR', [EUR]);
    expect(r).toMatchObject({ subtotalMinor: 10_000n, missing: ['GBP'] });
    expect(r.rows[1]).toEqual({ id: id(2), convertedMinor: null, rateAsOf: null });
  });

  it('gives no subtotal, not zero, when nothing can be converted', () => {
    expect(run([acct(1, 'GBP', 5_000n)], 'EUR', [EUR])).toMatchObject({ subtotalMinor: null, missing: ['GBP'] });
    expect(run([], 'EUR', [])).toMatchObject({ subtotalMinor: null, missing: [] });
  });

  it("names the group's own currency when it has no rate, and converts nothing foreign", () => {
    const r = run([acct(1, 'USD', 5_000n), acct(2, 'GBP', 100n)], 'EUR', [rate('GBP', E12, 100, 5)]);
    expect(r.missing).toEqual(['EUR']);
    expect(r.rows.map((x) => x.convertedMinor)).toEqual([null, null]);
    expect(r.subtotalMinor).toBeNull();
  });

  it('sorts two missing currencies, and a rate entered later removes it', () => {
    const accounts = [acct(1, 'PLN', 1n), acct(2, 'GBP', 1n), acct(3, 'EUR', 1n)];
    expect(run(accounts, 'EUR', [EUR]).missing).toEqual(['GBP', 'PLN']);
    expect(run(accounts, 'EUR', [EUR, rate('GBP', E12, 100, 1)]).missing).toEqual(['PLN']);
  });
});
