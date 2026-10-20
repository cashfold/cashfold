import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { CATALOGS, createTranslator, resolveLocale } from './i18n';
import { PSEUDO_LOCALE, pseudoLocalize } from './pseudo';

describe('pseudoLocalize', () => {
  it('accents letters, lengthens the text by about 40 percent and wraps it in markers', () => {
    const out = pseudoLocalize('Add transaction');
    expect(out.startsWith('[')).toBe(true);
    expect(out.endsWith(']')).toBe(true);
    expect(out).not.toContain('Add');
    expect(out.length).toBeGreaterThanOrEqual(Math.ceil('Add transaction'.length * 1.4));
  });

  it('keeps simple placeholders untouched', () => {
    const out = pseudoLocalize('Last changed {when} on {device}.');
    expect(out).toContain('{when}');
    expect(out).toContain('{device}');
  });

  it('keeps plural syntax and transforms only the words inside the branches', () => {
    const out = pseudoLocalize('{count, plural, =0 {No transactions} one {# transaction} other {# transactions}}');
    expect(out).toContain('{count, plural, =0 {');
    expect(out).toContain('one {');
    expect(out).toContain('other {');
    expect(out).not.toContain('No transactions');
    const format = new IntlMessageFormat(out, 'en');
    expect(String(format.format({ count: 0 }))).toMatch(/^\[?ÑÓ|Ñó/);
    expect(String(format.format({ count: 2 }))).toMatch(/2/);
  });

  it('keeps select syntax and number formats verbatim', () => {
    const out = pseudoLocalize('{kind, select, a {Alpha} other {Other}} {n, number, ::currency/USD}');
    expect(out).toContain('{kind, select, a {');
    expect(out).toContain('{n, number, ::currency/USD}');
  });

  it('keeps quoted ICU text verbatim', () => {
    const out = pseudoLocalize("It''s '{literal}' here");
    expect(() => new IntlMessageFormat(out, 'en')).not.toThrow();
    expect(String(new IntlMessageFormat(out, 'en').format())).toContain('{literal}');
  });
});

describe('the pseudo locale', () => {
  it('is registered as en-XA with a catalogue the formatter can parse for every message', () => {
    const catalogue = CATALOGS[PSEUDO_LOCALE];
    expect(catalogue).toBeDefined();
    const english = CATALOGS['en']!;
    expect(Object.keys(catalogue!).length).toBe(Object.keys(english).length);
    for (const [key, message] of Object.entries(catalogue!)) {
      expect(() => new IntlMessageFormat(message, 'en'), key).not.toThrow();
    }
  });

  it('preserves the placeholder names of every message', () => {
    const names = (message: string) => {
      const found = new Set<string>();
      const walk = (nodes: ReturnType<IntlMessageFormat['getAst']>): void => {
        for (const n of nodes) {
          if (n.type !== 0 && n.type !== 7) found.add(String((n as { value: string }).value));
          const options = (n as { options?: Record<string, { value: typeof nodes }> }).options;
          if (options) for (const o of Object.values(options)) walk(o.value);
        }
      };
      walk(new IntlMessageFormat(message, 'en').getAst());
      return [...found].sort();
    };
    for (const [key, message] of Object.entries(CATALOGS['en']!)) expect(names(CATALOGS[PSEUDO_LOCALE]![key]!), key).toEqual(names(message));
  });

  it('is never chosen from the browser language list, only on an exact en-XA', () => {
    expect(resolveLocale(['en-US'])).toBe('en');
    expect(resolveLocale(['en-XA'])).toBe(PSEUDO_LOCALE);
    expect(createTranslator(PSEUDO_LOCALE)('nav.label')).toMatch(/^\[.+\]$/);
  });
});
