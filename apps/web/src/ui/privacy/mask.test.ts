import { describe, expect, it } from 'vitest';
import { MASK, MASK_WIDTH_CLASS, maskedMoney } from './mask';

describe('the mask', () => {
  it('is the dots and the currency code, and nothing that depends on a figure', () => {
    expect(maskedMoney('USD')).toBe(`${MASK} USD`);
    expect(maskedMoney('UAH')).toBe(`${MASK} UAH`);
    expect(maskedMoney('USD')).not.toMatch(/\d/);
  });

  it('has the same width class whatever the currency, set by a class and not by an inline style', () => {
    expect(MASK_WIDTH_CLASS).toMatch(/min-w-/);
    expect(MASK_WIDTH_CLASS).not.toMatch(/style/);
  });
});
