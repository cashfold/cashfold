import { describe, expect, it } from 'vitest';
import { formatMoney, formatSigned } from '../ledger/format';
import { MASK_FIGURE_CLASS, maskedMoney, zeroed } from './mask';

describe('the mask', () => {
  it('replaces every digit with a zero and nothing else', () => {
    expect(zeroed('−1,234.56')).toBe('−0,000.00');
    expect(zeroed('+7.50')).toBe('+0.00');
    expect(zeroed('1 234,50')).toBe('0 000,00');
    expect(zeroed('USD')).toBe('USD');
    expect(zeroed('')).toBe('');
  });

  it('keeps the length, the sign, the marks and the currency code of the real text, and has no digit from 1 to 9', () => {
    const cases: Array<[bigint, string]> = [[1234n, 'USD'], [-450n, 'EUR'], [0n, 'USD'], [123_456_789n, 'UAH'], [-5n, 'JPY'], [12_345n, 'KWD']];
    for (const locale of ['en', 'uk', 'pl', 'de']) {
      for (const [minor, currency] of cases) {
        for (const real of [formatMoney(minor, currency, locale), formatSigned(minor, currency, locale)]) {
          const hidden = maskedMoney(real);
          expect(hidden, `${real} in ${locale}`).toHaveLength(real.length);
          expect(hidden).not.toMatch(/[1-9]/);
          expect(hidden.replace(/0/g, '#')).toBe(real.replace(/\d/g, '#'));
          expect(hidden.endsWith(` ${currency}`)).toBe(true);
        }
      }
    }
  });

  it('is only zeros, sign, marks and the code, so no digit of a real figure can be in it', () => {
    expect(maskedMoney(formatSigned(987_654_321n, 'USD', 'en'))).toBe('+0,000,000.00 USD');
    expect(maskedMoney(formatMoney(-450n, 'USD', 'en'))).toBe('−0.00 USD');
  });

  it('is blurred, drawn as generated content from an attribute, with no inline styles', () => {
    expect(MASK_FIGURE_CLASS).toMatch(/blur-\[0\.4em\]/);
    expect(MASK_FIGURE_CLASS).toMatch(/before:content-\[attr\(data-zeros\)\]/);
    expect(MASK_FIGURE_CLASS).toMatch(/select-none/);
    expect(MASK_FIGURE_CLASS).not.toMatch(/style/);
  });
});
