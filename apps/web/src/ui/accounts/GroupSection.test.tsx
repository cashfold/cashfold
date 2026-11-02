import type { AccountGroup, CurrencyCode, Id } from '@cashfold/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/i18n';
import type { AccountSection } from './account-sections';
import { GroupSectionView } from './GroupSection';

const t = createTranslator('en');
const group: AccountGroup = { id: 'g1' as Id, name: 'Household', icon: null, color: 0, sortOrder: 0, currency: null };
const cur = (c: string) => c as CurrencyCode;
const section = (over: Partial<AccountSection> = {}): AccountSection => ({ key: 'group-g1', kind: 'group', group, accounts: [{} as never], totals: [{ currency: cur('USD'), minor: 12345n }], ...over });
const render = (s: AccountSection, actions?: React.ReactNode) =>
  renderToStaticMarkup(<GroupSectionView t={t} locale="en" section={s} actions={actions}><ul><li>row</li></ul></GroupSectionView>);
const amounts = (html: string) => html.match(/data-sign=/g)?.length ?? 0;

describe('a group section', () => {
  it('has the group name in an h2 and labels the section by it', () => {
    const html = render(section());
    expect(html).toMatch(/<h2[^>]*id="([^"]+)"[^>]*>Household<\/h2>/);
    const id = /<h2[^>]*id="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`aria-labelledby="${id}"`);
    expect(html).toContain('<li>row</li>');
  });

  it('shows the subtotal with hidden text naming the group, and one amount per currency', () => {
    const html = render(section({ totals: [{ currency: cur('EUR'), minor: 100n }, { currency: cur('USD'), minor: 250n }] }));
    expect(html).toContain('Subtotal, Household');
    expect(amounts(html)).toBe(2);
    expect(html).toContain('1.00 EUR');
    expect(html).toContain('2.50 USD');
  });

  it('keeps the sign of a negative total', () => {
    expect(render(section({ totals: [{ currency: cur('USD'), minor: -500n }] }))).toContain('−5.00 USD');
  });

  it('says an empty group has no accounts and shows no amount', () => {
    const html = render(section({ accounts: [], totals: undefined }));
    expect(html).toContain('No accounts in this group yet');
    expect(amounts(html)).toBe(0);
  });

  it('says the subtotal is unavailable and shows no amount', () => {
    const html = render(section({ totals: 'unavailable' }));
    expect(html).toContain('Subtotal not available yet');
    expect(amounts(html)).toBe(0);
  });

  it('heads Ungrouped with its own text and gives it no actions', () => {
    const html = render({ key: 'ungrouped', kind: 'ungrouped', accounts: [{} as never], totals: [{ currency: cur('USD'), minor: 1n }] }, <button>Rename</button>);
    expect(html).toMatch(/<h2[^>]*>Ungrouped<\/h2>/);
    expect(html).not.toContain('Rename');
  });

  it('shows the actions slot for a group', () => {
    expect(render(section(), <button>Rename</button>)).toContain('Rename');
  });
});

describe('a converted group section (spec 021)', () => {
  const conv = (over: Partial<NonNullable<AccountSection['converted']>> = {}): NonNullable<AccountSection['converted']> => ({
    currency: cur('EUR'), subtotalMinor: 14_500n, ratesFrom: 1_761_955_200, missing: [], overflow: false, ...over,
  });
  const converted = (over: Partial<NonNullable<AccountSection['converted']>> = {}) => render(section({ converted: conv(over) }));

  it('shows one subtotal in the group currency, with the rates date in its tooltip', () => {
    const html = converted();
    expect(amounts(html)).toBe(1);
    expect(html).toContain('145.00 EUR');
    expect(html).toMatch(/title="Converted at rates from .*2025"/);
    expect(html).not.toContain('12345');
  });

  it('has no tooltip when no rate was needed', () => {
    expect(converted({ ratesFrom: null })).not.toContain('Converted at rates');
  });

  it('names the left-out currencies in a status note with a link to the rates', () => {
    const html = converted({ missing: [cur('PLN'), cur('USD')] });
    expect(html).toMatch(/role="status"[^>]*>Left out: no exchange rate for PLN, USD/);
    expect(html).toMatch(/<a[^>]*href="\/settings\/advanced\/?#adv-rates"[^>]*>Enter rates<\/a>/);
    expect(html).toContain('145.00 EUR');
  });

  it('says "No total yet" instead of a zero when nothing converts', () => {
    const html = converted({ subtotalMinor: null, missing: [cur('USD')], ratesFrom: null });
    expect(html).toContain('No total yet: exchange rate needed for USD');
    expect(amounts(html)).toBe(0);
  });

  it('says too large instead of a wrong figure on overflow', () => {
    const html = converted({ subtotalMinor: null, overflow: true });
    expect(html).toContain('Too large to convert');
    expect(amounts(html)).toBe(0);
  });

  it('keeps an Ungrouped section as one figure per currency, with no conversion text', () => {
    const html = render({ key: 'ungrouped', kind: 'ungrouped', accounts: [{} as never], totals: [{ currency: cur('EUR'), minor: 100n }, { currency: cur('USD'), minor: 250n }] });
    expect(amounts(html)).toBe(2);
    expect(html).not.toContain('Converted at rates');
  });
});

