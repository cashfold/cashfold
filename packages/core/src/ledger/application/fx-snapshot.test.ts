import { describe, expect, it } from 'vitest';
import { parseCurrency, type CurrencyCode } from '../../shared-kernel/currency';
import { divRoundHalfEven, money } from '../../shared-kernel/money';
import { id } from '../../testing/index';
import { validateExchangeRate, type ExchangeRate } from '../domain/exchange-rate';
import { snapshotBase } from './fx-snapshot';

const ccy = (c: string): CurrencyCode => {
  const r = parseCurrency(c);
  if (!r.ok) throw new Error('fixture');
  return r.value;
};
const rateRow = (n: number, quote: string, asOfUtcS: number, rateE12: bigint): ExchangeRate => {
  const r = validateExchangeRate({ quote, asOfUtcS, rateE12, source: 'service' });
  if (!r.ok) throw new Error(`fixture ${r.error.code}`);
  return { id: id(n), ...r.value };
};
const amount = (minor: bigint, c: string) => {
  const m = money(minor, ccy(c));
  if (!m.ok) throw new Error('fixture');
  return m.value;
};

const RATES = [
  rateRow(1, 'EUR', 100, 900_000_000_000n), //  0.90 EUR per USD
  rateRow(2, 'EUR', 200, 800_000_000_000n), //  0.80 EUR per USD
  rateRow(3, 'JPY', 100, 150_000_000_000_000n), // 150 JPY per USD
];

describe('base-currency snapshot', () => {
  it('is the amount itself, with no rate, when the currency is the base currency', () => {
    const r = snapshotBase({ amount: amount(-1234n, 'USD'), baseCurrency: ccy('USD'), rates: RATES, asOfUtcS: 150 });
    expect(r).toEqual({ ok: true, value: { baseAmountMinor: -1234n, baseCurrency: 'USD', fxRateId: null, fxBaseRateId: null } });
  });

  it('converts into a base currency through the USD pivot using the nearest prior rate, and records which rate', () => {
    const r = snapshotBase({ amount: amount(-9000n, 'USD'), baseCurrency: ccy('EUR'), rates: RATES, asOfUtcS: 150 });
    expect(r).toEqual({ ok: true, value: { baseAmountMinor: -8100n, baseCurrency: 'EUR', fxRateId: null, fxBaseRateId: id(1) } });
  });

  it('uses the newer rate once its time has come', () => {
    const r = snapshotBase({ amount: amount(-9000n, 'USD'), baseCurrency: ccy('EUR'), rates: RATES, asOfUtcS: 200 });
    expect(r.ok && r.value.baseAmountMinor).toBe(-7200n);
    expect(r.ok && r.value.fxBaseRateId).toBe(id(2));
  });

  it('converts from a foreign currency into a USD base', () => {
    const r = snapshotBase({ amount: amount(-9000n, 'EUR'), baseCurrency: ccy('USD'), rates: RATES, asOfUtcS: 150 });
    expect(r).toEqual({ ok: true, value: { baseAmountMinor: -10_000n, baseCurrency: 'USD', fxRateId: id(1), fxBaseRateId: null } });
  });

  it('crosses two non-USD currencies with a single division and a single rounding', () => {
    const eur = amount(-1_000n, 'EUR'); // 10.00 EUR
    const r = snapshotBase({ amount: eur, baseCurrency: ccy('JPY'), rates: RATES, asOfUtcS: 150 });
    // 10.00 EUR = 11.11.. USD = 1666.66.. JPY: one division of the whole expression, then one rounding.
    const expected = divRoundHalfEven(-1_000n * 10n ** 0n * 150_000_000_000_000n, 10n ** 2n * 900_000_000_000n);
    expect(r.ok && r.value.baseAmountMinor).toBe(expected);
    expect(r.ok && r.value.fxRateId).toBe(id(1));
    expect(r.ok && r.value.fxBaseRateId).toBe(id(3));
  });

  it('rounds half to even exactly once', () => {
    // 0.5 USD cent * 0.9 = 0.45 -> 0; 5 * 0.9 = 4.5 -> 4 (even); 15 * 0.9 = 13.5 -> 14 (even)
    const at = (minor: bigint) => {
      const r = snapshotBase({ amount: amount(minor, 'USD'), baseCurrency: ccy('EUR'), rates: RATES, asOfUtcS: 150 });
      return r.ok ? r.value.baseAmountMinor : undefined;
    };
    expect(at(5n)).toBe(4n);
    expect(at(15n)).toBe(14n);
    expect(at(-5n)).toBe(-4n);
    expect(at(-15n)).toBe(-14n);
  });

  it('keeps zero-decimal and large amounts exact', () => {
    const big = 2n ** 53n + 1n;
    const r = snapshotBase({ amount: amount(big, 'USD'), baseCurrency: ccy('JPY'), rates: RATES, asOfUtcS: 150 });
    // JPY has no minor unit: 150 JPY per USD, and a USD minor unit is one hundredth of a dollar.
    expect(r.ok && r.value.baseAmountMinor).toBe(divRoundHalfEven(big * 150_000_000_000_000n, 100n * 10n ** 12n));
  });

  it('needs a rate: with none known it refuses and names the currency, never guessing', () => {
    const r = snapshotBase({ amount: amount(-100n, 'USD'), baseCurrency: ccy('GBP'), rates: RATES, asOfUtcS: 150 });
    expect(r).toMatchObject({ ok: false, error: { code: 'rate_required', currency: 'GBP' } });
    const before = snapshotBase({ amount: amount(-100n, 'USD'), baseCurrency: ccy('EUR'), rates: RATES, asOfUtcS: 50 });
    expect(before).toMatchObject({ ok: false, error: { code: 'rate_required', currency: 'EUR' } });
  });

  it('refuses a result outside 64 bits', () => {
    const r = snapshotBase({ amount: amount(2n ** 62n, 'USD'), baseCurrency: ccy('JPY'), rates: [rateRow(9, 'JPY', 1, 2n ** 62n)], asOfUtcS: 5 });
    expect(r).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
  });
});
