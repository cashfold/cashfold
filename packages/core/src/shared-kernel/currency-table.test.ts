import { describe, expect, it } from 'vitest';
import { CURRENCY_EXPONENTS } from './currency-table.js';
import { exponentOf, parseCurrency } from './currency.js';

describe('currency exponent table', () => {
  it('gives every code an integer exponent in 0..8', () => {
    for (const [code, exp] of Object.entries(CURRENCY_EXPONENTS)) {
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect(Number.isInteger(exp)).toBe(true);
      expect(exp).toBeGreaterThanOrEqual(0);
      expect(exp).toBeLessThanOrEqual(8);
    }
  });

  it.each([
    ['USD', 2],
    ['EUR', 2],
    ['JPY', 0],
    ['KRW', 0],
    ['BHD', 3],
    ['KWD', 3],
    ['CLF', 4],
    ['BTC', 8],
  ])('%s has exponent %i', (code, exp) => {
    expect(CURRENCY_EXPONENTS[code]).toBe(exp);
  });

  it('covers zero-, two-, three- and eight-decimal currencies (FR-038)', () => {
    const exps = new Set(Object.values(CURRENCY_EXPONENTS));
    for (const e of [0, 2, 3, 4, 8]) expect(exps.has(e)).toBe(true);
  });

  it('parseCurrency validates against the table', () => {
    expect(parseCurrency('USD').ok).toBe(true);
    expect(parseCurrency('usd')).toEqual({ ok: false, error: expect.objectContaining({ code: 'unknown_currency' }) });
    expect(parseCurrency('ZZZ').ok).toBe(false);
    expect(parseCurrency('').ok).toBe(false);
  });

  it('exposes the exponent through the branded currency', () => {
    const r = parseCurrency('BHD');
    if (!r.ok) throw new Error('expected ok');
    expect(exponentOf(r.value)).toBe(3);
  });
});
