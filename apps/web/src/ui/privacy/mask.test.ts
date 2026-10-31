import { describe, expect, it } from 'vitest';
import { MASK_FIGURE_CLASS, MASK_WIDTH_CLASS, maskedFigure, maskedMoney } from './mask';

describe('the mask', () => {
  it('is a fixed row of zeros in the locale\'s own marks, and the currency code', () => {
    expect(maskedFigure('en')).toBe('0,000.00');
    expect(maskedFigure('de')).toBe('0.000,00');
    expect(maskedMoney('USD', 'en')).toBe('0,000.00 USD');
    expect(maskedMoney('EUR', 'de')).toBe('0.000,00 EUR');
  });

  it('is only zeros and separators, so no digit of a real figure can be in it', () => {
    for (const locale of ['en', 'uk', 'pl', 'de']) expect(maskedFigure(locale)).toMatch(/^[0.,\s  ]+$/);
  });

  it('is the same whatever the figure it stands in for, and has no sign', () => {
    expect(maskedMoney('USD', 'en')).toBe(maskedMoney('USD', 'en'));
    expect(maskedMoney('USD', 'en')).not.toMatch(/[+−-]/);
  });

  it('is blurred, drawn as generated content from an attribute, and fixed in width by classes, not by inline styles', () => {
    expect(MASK_FIGURE_CLASS).toMatch(/blur-\[0\.4em\]/);
    expect(MASK_FIGURE_CLASS).toMatch(/before:content-\[attr\(data-zeros\)\]/);
    expect(MASK_FIGURE_CLASS).toMatch(/select-none/);
    expect(MASK_WIDTH_CLASS).toMatch(/min-w-/);
    expect(`${MASK_FIGURE_CLASS} ${MASK_WIDTH_CLASS}`).not.toMatch(/style/);
  });
});
