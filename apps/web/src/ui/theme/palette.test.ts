import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIMARY, PALETTE, PRIMARY_IDS, parsePrimary } from './palette';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
// The page colours of each theme (tokens.css).
const PAGE = { light: { bg: '#ffffff', surface: '#fafafa' }, dark: { bg: '#09090b', surface: '#18181b' } } as const;

describe('the palette', () => {
  it('has unique ids and starts with the default', () => {
    expect(new Set(PRIMARY_IDS).size).toBe(PRIMARY_IDS.length);
    expect(PRIMARY_IDS[0]).toBe(DEFAULT_PRIMARY);
    expect(PRIMARY_IDS.length).toBeGreaterThanOrEqual(8);
  });

  it('keeps the original green as the default', () => {
    expect(PALETTE[0].light).toMatchObject({ primary: '#047857', focus: '#059669' });
    expect(PALETTE[0].dark).toMatchObject({ primary: '#10b981', accentText: '#34d399' });
  });

  describe.each(PALETTE.map((c) => [c.id, c] as const))('%s', (_id, color) => {
    describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
      const v = color[theme];
      const page = PAGE[theme];
      it('has readable text on the primary colour (4.5:1)', () => {
        expect(contrast(v.onPrimary, v.primary)).toBeGreaterThanOrEqual(4.5);
      });
      it('is readable as text and as a control on the page (4.5:1)', () => {
        expect(contrast(v.primary, page.bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v.accentText, page.bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v.accentText, page.surface)).toBeGreaterThanOrEqual(4.5);
      });
      it('has a focus ring visible against the page (3:1)', () => {
        expect(contrast(v.focus, page.bg)).toBeGreaterThanOrEqual(3);
      });
    });
  });
});

describe('parsePrimary', () => {
  it.each(PRIMARY_IDS)('keeps %s', (id) => expect(parsePrimary(id)).toBe(id));
  it.each([undefined, null, '', 'purple', 3, {}, 'EMERALD'])('falls back to the default for %j', (x) => expect(parsePrimary(x)).toBe(DEFAULT_PRIMARY));
});
