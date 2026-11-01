import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PrivacyContext, type PrivacyApi } from '../privacy/usePrivacy';
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

// Privacy mode (spec 016, 018): masked amounts are the figure's shape in zeros with its sign and colour, and are a way to reveal that one amount.
const mode = (on: boolean): PrivacyApi => ({ on, toggle: () => undefined, reveal: () => undefined });
const masked = (props: Partial<Parameters<typeof Amount>[0]> & { minor: bigint }) =>
  renderToStaticMarkup(<PrivacyContext.Provider value={mode(true)}><Amount currency="USD" locale="en" {...props} /></PrivacyContext.Provider>);

describe('Amount with Privacy mode', () => {
  it('prints exactly what it printed before when the mode is off, or when there is no provider', () => {
    const off = renderToStaticMarkup(<PrivacyContext.Provider value={mode(false)}><Amount minor={-450n} currency="USD" locale="en" tone="auto" showSign /></PrivacyContext.Provider>);
    expect(off).toBe(html({ minor: -450n, tone: 'auto', showSign: true }));
    expect(text(off)).toBe('−4.50 USD');
    expect(off).toContain('data-sign="loss"');
  });

  it.each([123_456n, -450n, 0n, 2n ** 62n])('shows %s as zeros in the shape of the figure: no digit but zero, the sign, the colour and the code kept', (minor) => {
    const out = masked({ minor, tone: 'auto', showSign: true });
    // Only the currency code is text: the zeros are generated content, so no digit is in the text at all.
    expect(text(out).trim()).toBe('USD');
    expect(out.replace(/blur-\[0\.4em\]|outline-2|outline-\(--focus\)/g, '')).not.toMatch(/[1-9]/);
    const real = html({ minor, tone: 'auto', showSign: true });
    expect(out).toContain(`data-zeros="${text(real).replace(/ USD$/, '').replace(/\d/g, '0')}"`);
    expect(out).toContain(`data-sign="${minor > 0n ? 'gain' : minor < 0n ? 'loss' : 'zero'}"`);
    expect(out.match(/text-\(--(success|danger)\)/)?.[0]).toBe(real.match(/text-\(--(success|danger)\)/)?.[0]);
  });

  it('keeps the sign: a loss has the minus, a gain the plus, and the colours of the shown amount', () => {
    expect(masked({ minor: -450n, tone: 'auto' })).toContain('data-zeros="−0.00"');
    expect(masked({ minor: -450n, tone: 'auto' })).toContain('text-(--danger)');
    expect(masked({ minor: 450n, tone: 'auto' })).toContain('data-zeros="+0.00"');
    expect(masked({ minor: 450n, tone: 'auto' })).toContain('text-(--success)');
    expect(masked({ minor: 450n })).toContain('data-zeros="0.00"');
  });

  it('keeps the currency code and has no fixed width, the zeros being as long as the figure', () => {
    expect(text(masked({ minor: 1n, currency: 'EUR' })).trim()).toBe('EUR');
    expect(masked({ minor: 1n })).not.toContain('min-w-');
    expect(masked({ minor: 1n })).toMatch(/class="[^"]*\btabular-nums\b/);
    expect(masked({ minor: 1n })).toContain('data-zeros="0.00"');
    expect(masked({ minor: 99_999_999n })).toContain('data-zeros="000,000.00"');
  });

  it('is a button a keyboard can reach, named as a hidden amount, with no figure in its name', () => {
    const out = masked({ minor: 123_456n });
    expect(out).toContain('role="button"');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('aria-label="Hidden amount, USD. Press to reveal."');
    expect(out).not.toMatch(/1,?234/);
  });

  it('is plain text, not focusable, when it sits inside something clickable', () => {
    const out = masked({ minor: 123_456n, inert: true });
    expect(out).not.toContain('tabindex');
    expect(out).not.toContain('role="button"');
    expect(text(out).trim()).toBe('USDHidden amount, USD. Press to reveal.');
  });

  it('puts the zeros in a blurred span a reader skips', () => {
    const small = masked({ minor: 1n });
    expect(small).toMatch(/<span aria-hidden="true" data-privacy-mask="true" data-zeros="0\.00" class="[^"]*blur-\[0\.4em\][^"]*before:content-\[attr\(data-zeros\)\][^"]*"><\/span>/);
    expect(small).toContain('<span aria-hidden="true">USD</span>');
  });
});

describe('Amount at the size of a long list (spec 016)', () => {
  const many = (on: boolean) => renderToStaticMarkup(
    <PrivacyContext.Provider value={mode(on)}>
      {Array.from({ length: 300 }, (_, i) => <Amount key={i} minor={BigInt(i * 1_000 + 7)} currency="USD" locale="en" tone="auto" showSign />)}
    </PrivacyContext.Provider>,
  );

  it('draws 300 masked amounts, and 300 plain ones, without noticeable delay', () => {
    many(true);
    many(false); // warm up
    for (const on of [true, false]) {
      const started = performance.now();
      many(on);
      // A generous bound: the aim is one frame; this catches a slowdown by a factor of several, not a busy machine.
      expect(performance.now() - started, `300 amounts, mode ${on ? 'on' : 'off'}`).toBeLessThan(300);
    }
  });
});

