import type { AccountGroup, CurrencyCode, Id } from '@cashfold/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/i18n';
import type { AccountSection } from './account-sections';
import { GroupSectionView } from './GroupSection';

const t = createTranslator('en');
const group: AccountGroup = { id: 'g1' as Id, name: 'Household', icon: null, color: 0, sortOrder: 0 };
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
