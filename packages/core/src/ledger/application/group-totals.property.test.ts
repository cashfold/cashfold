import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CurrencyCode } from '../../shared-kernel/currency';
import { convert } from '../../shared-kernel/fx';
import { money } from '../../shared-kernel/money';
import { id } from '../../testing/index';
import { nearestPrior, PIVOT_CURRENCY, type ExchangeRate } from '../domain/exchange-rate';
import { groupBalances } from './group-totals';

const E12 = 10n ** 12n;
const CURRENCIES = ['USD', 'EUR', 'PLN', 'JPY', 'KWD'];
const NOW = 5_000;

const accountArb = fc.record({ currency: fc.constantFrom(...CURRENCIES), balanceMinor: fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }) });
const ratesArb = fc.array(
  fc.record({ quote: fc.constantFrom('EUR', 'PLN', 'JPY', 'KWD'), asOfUtcS: fc.integer({ min: 0, max: 8_000 }), rateE12: fc.bigInt({ min: E12 / 100n, max: 500n * E12 }) }),
  { maxLength: 12 },
).map((rows) => rows.map((r, i): ExchangeRate => ({ id: id(100 + i), source: 'service', ...r, rateE12: r.rateE12 as never, quote: r.quote as never })));

const reference = (rates: ExchangeRate[], currency: string, minor: bigint, target: string): bigint | null => {
  if (currency === target) return minor;
  const rateOf = (c: string) => (c === PIVOT_CURRENCY ? E12 : nearestPrior(rates, c, NOW)?.rateE12);
  const from = rateOf(currency);
  const to = rateOf(target);
  const m = money(minor, currency as CurrencyCode);
  if (from === undefined || to === undefined || !m.ok) return null;
  const c = convert(m.value, target as CurrencyCode, from as never, to as never);
  return c.ok ? c.value.minor : null;
};

describe('groupBalances: properties', () => {
  it('the subtotal is the sum of the figures, each figure is the reference conversion, and the order does not matter', () => {
    fc.assert(
      fc.property(fc.array(accountArb, { maxLength: 8 }), ratesArb, fc.constantFrom(...CURRENCIES), (list, rates, target) => {
        const accounts = list.map((a, i) => ({ id: id(i + 1), currency: a.currency as CurrencyCode, balanceMinor: a.balanceMinor }));
        const r = groupBalances({ accounts, groupCurrency: target as CurrencyCode, rates, asOfUtcS: NOW });
        let sum = 0n;
        let any = false;
        accounts.forEach((a, i) => {
          const want = reference(rates, a.currency, a.balanceMinor!, target);
          expect(r.rows[i]!.convertedMinor).toBe(want);
          if (want !== null) { sum += want; any = true; }
        });
        expect(r.subtotalMinor).toBe(any ? sum : null);
        const flipped = groupBalances({ accounts: [...accounts].reverse(), groupCurrency: target as CurrencyCode, rates: [...rates].reverse(), asOfUtcS: NOW });
        expect(flipped.subtotalMinor).toBe(r.subtotalMinor);
        expect(flipped.missing).toEqual(r.missing);
      }),
      { numRuns: 1_000 },
    );
  });
});
