import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Amount } from './amount';

const html = (props: Partial<Parameters<typeof Amount>[0]> & { minor: bigint }) =>
  renderToStaticMarkup(<Amount currency="USD" locale="en" {...props} />);
const text = (markup: string) => markup.replace(/<[^>]+>/g, '');

describe('Amount', () => {
  it('prints bigint minor units with the locale grouping and the currency', () => {
    expect(text(html({ minor: 123_456n }))).toBe('1,234.56 USD');
    expect(text(html({ minor: 123_456n, currency: 'EUR', locale: 'de' }))).toBe('1.234,56 EUR');
    expect(text(html({ minor: 2n ** 62n }))).toBe('46,116,860,184,273,879.04 USD');
  });

  it('writes the minus as text, so a loss is never colour alone', () => {
    expect(text(html({ minor: -450n }))).toBe('−4.50 USD');
    expect(text(html({ minor: -450n, tone: 'auto' }))).toBe('−4.50 USD');
  });

  it('adds a plus to a gain when asked, and always when colouring by sign', () => {
    expect(text(html({ minor: 100n }))).toBe('1.00 USD');
    expect(text(html({ minor: 100n, showSign: true }))).toBe('+1.00 USD');
    expect(text(html({ minor: 100n, tone: 'auto' }))).toBe('+1.00 USD');
  });

  it('uses tabular figures and does not break inside the number', () => {
    expect(html({ minor: 1n })).toMatch(/class="[^"]*\btabular-nums\b/);
    expect(html({ minor: 1n })).toMatch(/\bwhitespace-nowrap\b/);
  });

  it('colours by sign only on request; zero stays neutral', () => {
    expect(html({ minor: 100n })).not.toMatch(/text-\(--/);
    expect(html({ minor: 100n, tone: 'auto' })).toMatch(/text-\(--success\)/);
    expect(html({ minor: -100n, tone: 'auto' })).toMatch(/text-\(--danger\)/);
    expect(html({ minor: 0n, tone: 'auto' })).not.toMatch(/text-\(--/);
  });

  it('marks the direction for assistive technology', () => {
    expect(html({ minor: 100n, tone: 'auto' })).toContain('data-sign="gain"');
    expect(html({ minor: -100n })).toContain('data-sign="loss"');
    expect(html({ minor: 0n })).toContain('data-sign="zero"');
  });

  it('aligns to the end in a table cell (logical, so it mirrors in right-to-left)', () => {
    expect(html({ minor: 1n, align: 'end' })).toContain('text-end');
  });
});
