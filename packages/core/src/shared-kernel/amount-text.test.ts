import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatAmount, parseAmountText, type Separators } from './amount-text.js';
import { parseCurrency } from './currency.js';
import { MAX_MINOR, MIN_MINOR, money } from './money.js';

const cur = (code: string) => {
  const r = parseCurrency(code);
  if (!r.ok) throw new Error(code);
  return r.value;
};
const USD = cur('USD');
const JPY = cur('JPY');
const BHD = cur('BHD');
const BTC = cur('BTC');
const EN: Separators = { decimal: '.', group: ',' };
const DE: Separators = { decimal: ',', group: '.' };

const minorOf = (text: string, c = USD, sep = EN) => {
  const r = parseAmountText(text, c, sep);
  return r.ok ? r.value.minor : r.error.code;
};

describe('parseAmountText', () => {
  it('parses exact decimals without float intermediates', () => {
    expect(minorOf('0.07')).toBe(7n);
    expect(minorOf('1234.56')).toBe(123456n);
    expect(minorOf('0.1')).toBe(10n);
    expect(minorOf('19.99')).toBe(1999n);
    expect(minorOf('92233720368547758.07')).toBe(MAX_MINOR);
    expect(minorOf('-92233720368547758.08')).toBe(MIN_MINOR);
  });

  it('honours currency exponents', () => {
    expect(minorOf('500', JPY)).toBe(500n);
    expect(minorOf('1.234', BHD)).toBe(1234n);
    expect(minorOf('0.00000001', BTC)).toBe(1n);
  });

  it('rejects more fractional digits than the exponent, never rounding', () => {
    expect(minorOf('1.234')).toBe('too_many_decimals');
    expect(minorOf('1.5', JPY)).toBe('too_many_decimals');
    expect(minorOf('0.000000001', BTC)).toBe('too_many_decimals');
  });

  it('accepts a sign and locale separators', () => {
    expect(minorOf('-12.30')).toBe(-1230n);
    expect(minorOf('+12.3')).toBe(1230n);
    expect(minorOf('1,234.50')).toBe(123450n);
    expect(minorOf('1.234,50', USD, DE)).toBe(123450n);
    expect(minorOf('12,5', USD, DE)).toBe(1250n);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', ' ', '-', '.', '1.', 'abc', '1e3', '1.2.3', '1,23.00', '1,2345.00', '--1', '1 000']) {
      expect(minorOf(bad)).toBe('invalid_format');
    }
  });

  it('rejects out-of-range values', () => {
    expect(minorOf('92233720368547758.08')).toBe('out_of_range');
    expect(minorOf('-92233720368547758.09')).toBe('out_of_range');
  });

  it('trims surrounding whitespace', () => {
    expect(minorOf('  5.00 ')).toBe(500n);
  });
});

describe('formatAmount', () => {
  const fmt = (minor: bigint, c = USD, sep = EN) => {
    const m = money(minor, c);
    if (!m.ok) throw new Error('bad money');
    return formatAmount(m.value, sep);
  };

  it('formats with grouping, sign and exponent digits', () => {
    expect(fmt(123456n)).toBe('1,234.56');
    expect(fmt(5n)).toBe('0.05');
    expect(fmt(-5n)).toBe('-0.05');
    expect(fmt(0n)).toBe('0.00');
    expect(fmt(1234567n, JPY)).toBe('1,234,567');
    expect(fmt(1234n, BHD)).toBe('1.234');
    expect(fmt(123450n, USD, DE)).toBe('1.234,50');
    expect(fmt(MIN_MINOR)).toBe('-92,233,720,368,547,758.08');
  });

  it('property: parse(format(m)) round-trips for every currency and locale', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: MIN_MINOR, max: MAX_MINOR }),
        fc.constantFrom(USD, JPY, BHD, BTC),
        fc.constantFrom(EN, DE),
        (minor, c, sep) => {
          const m = money(minor, c);
          if (!m.ok) throw new Error('bad money');
          const back = parseAmountText(formatAmount(m.value, sep), c, sep);
          expect(back).toEqual({ ok: true, value: m.value });
        },
      ),
    );
  });
});
