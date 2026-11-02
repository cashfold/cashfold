import { describe, expect, it } from 'vitest';
import type { Separators } from './amount-text';
import { evaluateAmount, isAmountExpression } from './amount-expression';
import { parseCurrency } from './currency';

const cur = (code: string) => {
  const r = parseCurrency(code);
  if (!r.ok) throw new Error(code);
  return r.value;
};
const USD = cur('USD');
const JPY = cur('JPY');
const BHD = cur('BHD');
const EN: Separators = { decimal: '.', group: ',' };
const DE: Separators = { decimal: ',', group: '.' };
const PL: Separators = { decimal: ',', group: ' ' };

const minorOf = (text: string, c = USD, sep = EN) => {
  const r = evaluateAmount(text, c, sep);
  return r.ok ? r.value.minor : r.error.code;
};

describe('isAmountExpression', () => {
  it('is false for a plain or signed number and true for a sum or a bracket', () => {
    for (const plain of ['12.50', '-5', '+5', ' 12.50 ', '1,234.56', '', '   ']) expect(isAmountExpression(plain), plain).toBe(false);
    for (const sum of ['5+3', '5 + 3', '(5)', '2*3', '2 x 3', '2×3', '8/2', '8÷2', '5-3', '-5+8']) expect(isAmountExpression(sum), sum).toBe(true);
  });
});

describe('evaluateAmount: results', () => {
  it('adds, subtracts, multiplies and divides with the usual order', () => {
    expect(minorOf('12.50 + 3.20 * 2 + 4')).toBe(2290n);
    expect(minorOf('(10 + 5) * 2')).toBe(3000n);
    expect(minorOf('10 + 5 * 2')).toBe(2000n);
    expect(minorOf('120 - 15')).toBe(10500n);
    expect(minorOf('84 / 3')).toBe(2800n);
    expect(minorOf('-5 + 8')).toBe(300n);
    expect(minorOf('5 + -3')).toBe(200n);
    expect(minorOf('100 - 30 - 20')).toBe(5000n);
    expect(minorOf('100 / 5 / 2')).toBe(1000n);
    expect(minorOf('((2 + 3) * (4 - 1))')).toBe(1500n);
  });

  it('takes x, ×, * for multiplication and /, ÷ for division, and ignores spaces', () => {
    const results = ['2 x 3', '2 × 3', '2 * 3', '2x3', '  2  *  3  '].map((t) => minorOf(t));
    expect(new Set(results)).toEqual(new Set([600n]));
    expect(minorOf('8 ÷ 2')).toBe(400n);
    expect(minorOf('8 / 2')).toBe(400n);
    expect(minorOf('9 − 4')).toBe(500n);
  });

  it('is exact: no fraction of a cent is lost or invented', () => {
    expect(minorOf('0.1 + 0.2')).toBe(30n);
    expect(minorOf('10 / 3 * 3')).toBe(1000n);
    expect(minorOf('1 / 3 + 1 / 3 + 1 / 3')).toBe(100n);
    expect(minorOf('0.333 * 3')).toBe(100n); // an operand may have more decimals inside a sum
  });

  it('rounds once, at the end, half to even', () => {
    expect(minorOf('10 / 3')).toBe(333n);
    expect(minorOf('20 / 3')).toBe(667n);
    expect(minorOf('0.125 * 1')).toBe(12n);
    expect(minorOf('0.135 * 1')).toBe(14n);
    expect(minorOf('-10 / 3')).toBe(-333n);
    expect(minorOf('-0.125 * 1')).toBe(-12n);
    expect(minorOf('-0.135 * 1')).toBe(-14n);
  });

  it('uses the currency\'s own decimals', () => {
    expect(minorOf('100 / 3', JPY)).toBe(33n);
    expect(minorOf('1 / 3', BHD)).toBe(333n);
    expect(minorOf('2 / 3', BHD)).toBe(667n);
  });

  it('reads numbers with the language\'s own marks', () => {
    expect(minorOf('1,234.50 + 10.25', USD, EN)).toBe(124475n);
    expect(minorOf('1.234,50 + 10,25', USD, DE)).toBe(124475n);
    expect(minorOf('1 234,50 + 10,25', USD, PL)).toBe(124475n);
    expect(minorOf('1 234,50 + 10,25', USD, PL)).toBe(124475n); // an ordinary space typed for the group mark
  });

  it('keeps the typing leniency inside each number (a dot for the decimal comma, any space around an operator)', () => {
    expect(minorOf('1.5 + 2.5', USD, PL)).toBe(400n);
    expect(minorOf('10 + 5', USD, PL)).toBe(1500n);
    expect(minorOf('10 + 5', USD, PL)).toBe(1500n);
    expect(minorOf('1 234,50 * 2', USD, PL)).toBe(246900n);
    expect(minorOf('1.234,50 + 1', USD, DE)).toBe(123550n); // a dot is the group mark in German, so it stays one
  });

  it('treats a bracket around a number as a sum that evaluates to it', () => {
    expect(minorOf('(5)')).toBe(500n);
  });
});

describe('evaluateAmount: errors', () => {
  it.each(['12 +', '+ 12 *', '5 ++ 3', '*5', '(', ')', '()', '(1', '1)', '1 2 +', 'abc', '12 $ 3', '', '   ', '+ - *', '1..2 + 3', '1.2.3 + 4', '5 +* 3'])(
    '%j is invalid_format',
    (text) => expect(minorOf(text)).toBe('invalid_format'),
  );

  it('refuses division by zero', () => {
    expect(minorOf('5 / 0')).toBe('division_by_zero');
    expect(minorOf('5 / (3 - 3)')).toBe('division_by_zero');
    expect(minorOf('0 / 0')).toBe('division_by_zero');
    expect(minorOf('5 ÷ 0.00')).toBe('division_by_zero');
  });

  it('refuses a result outside the supported range', () => {
    expect(minorOf('92233720368547758.07 + 0.01')).toBe('out_of_range');
    expect(minorOf('100000000000000000 * 10')).toBe('out_of_range');
    expect(minorOf('-92233720368547758.08 - 0.01')).toBe('out_of_range');
    expect(minorOf('92233720368547758.07 + 0')).toBe(9223372036854775807n);
  });

  it('refuses a text that is too long or nested too deep, without throwing', () => {
    expect(minorOf(`1${' + 1'.repeat(100)}`)).toBe('invalid_format');
    expect(minorOf(`${'('.repeat(21)}1${')'.repeat(21)}`)).toBe('invalid_format');
    expect(minorOf(`${'('.repeat(20)}1${')'.repeat(20)}`)).toBe(100n);
  });

  it('never throws, whatever the text', () => {
    for (const text of ['\u0000', '😀 + 1', '1e5 + 1', '0x10 + 1', '1 + (2 * (3 +', '٣ + ٤', '1 / 0.0000001', '9'.repeat(150), `1${'0'.repeat(150)} * 1`]) {
      expect(() => evaluateAmount(text, USD, EN), text).not.toThrow();
    }
  });
});
