import { describe, expect, it } from 'vitest';
import { DESKTOP_SETTINGS_GROUP, PRIMARY_SECTIONS, REDIRECTS, ROUTES, SETTINGS_GROUPS, matchSection, redirectTarget } from './routes';

describe('route table (contracts/routes.md)', () => {
  it('has exactly five primary sections, in order', () => {
    expect(PRIMARY_SECTIONS.map((s) => s.id)).toEqual(['overview', 'transactions', 'accounts', 'plan', 'settings']);
    expect(PRIMARY_SECTIONS.map((s) => s.href)).toEqual(['/overview/', '/transactions/', '/accounts/', '/plan/', '/settings/']);
    expect(new Set(PRIMARY_SECTIONS.map((s) => s.labelKey)).size).toBe(5);
  });

  it('has at most seven settings groups, each with a route and a description key', () => {
    expect(SETTINGS_GROUPS.map((g) => g.id)).toEqual(['profile', 'appearance', 'categories', 'sync', 'data', 'folds', 'advanced']);
    for (const g of SETTINGS_GROUPS) {
      expect(g.href).toBe(`/settings/${g.id}/`);
      expect(ROUTES.has(g.href)).toBe(true);
      expect(g.labelKey).toMatch(/^settings\.group\./);
      expect(g.descriptionKey).toBe(`${g.labelKey}.description`);
    }
  });

  it('has one more group only the desktop app shows, outside the seven', () => {
    expect(DESKTOP_SETTINGS_GROUP.href).toBe('/settings/desktop/');
    expect(DESKTOP_SETTINGS_GROUP.labelKey).toBe('settings.group.desktop');
    expect(DESKTOP_SETTINGS_GROUP.descriptionKey).toBe('settings.group.desktop.description');
    expect(SETTINGS_GROUPS.some((g) => g.id === 'desktop')).toBe(false);
  });

  it('ends every route with a slash (the static export uses trailing slashes)', () => {
    for (const route of ROUTES) expect(route).toMatch(/\/$/);
    for (const r of REDIRECTS) expect(r.from).toMatch(/\/$/);
  });

  it('sends every redirect to a route that exists, and no source is a primary route or a settings group', () => {
    for (const r of REDIRECTS) {
      const path = r.to.split('?')[0]!;
      expect(ROUTES.has(path), `${r.from} -> ${r.to}`).toBe(true);
      expect(PRIMARY_SECTIONS.some((s) => s.href === r.from), r.from).toBe(false);
      expect(SETTINGS_GROUPS.some((g) => g.href === r.from), r.from).toBe(false);
      expect(ROUTES.has(r.from), r.from).toBe(false);
    }
  });

  it('has the redirect table of contracts/routes.md §5', () => {
    const table = Object.fromEntries(REDIRECTS.map((r) => [r.from, r.to]));
    expect(table).toEqual({
      '/dashboard/': '/overview/',
      '/transfers/': '/transactions/?new=transfer',
      '/budgets/': '/plan/?view=budgets',
      '/goals/': '/plan/?view=goals',
      '/schedules/': '/plan/?view=schedules',
      '/categories/': '/settings/categories/',
      '/data/': '/settings/data/',
      '/devices/': '/settings/sync/',
      '/folds/': '/settings/folds/',
    });
  });
});

describe('redirectTarget', () => {
  it('keeps the query string of the old address and merges it with the target query', () => {
    expect(redirectTarget('/dashboard/', '')).toBe('/overview/');
    expect(redirectTarget('/dashboard/', '?x=1')).toBe('/overview/?x=1');
    expect(redirectTarget('/transfers/', '?account=a1')).toBe('/transactions/?new=transfer&account=a1');
    expect(redirectTarget('/budgets/', '')).toBe('/plan/?view=budgets');
  });
  it('returns nothing for a route that is not an old address', () => {
    expect(redirectTarget('/overview/', '')).toBeUndefined();
    expect(redirectTarget('/transactions/', '?account=a1')).toBeUndefined();
  });
});

describe('matchSection', () => {
  it('matches a section for its route and every sub-route', () => {
    expect(matchSection('/overview/')).toBe('overview');
    expect(matchSection('/overview')).toBe('overview');
    expect(matchSection('/settings/')).toBe('settings');
    expect(matchSection('/settings/appearance/')).toBe('settings');
    expect(matchSection('/plan/')).toBe('plan');
  });
  it('matches nothing for other routes', () => {
    expect(matchSection('/')).toBeUndefined();
    expect(matchSection('/sign-up/')).toBeUndefined();
    expect(matchSection('/settingsx/')).toBeUndefined();
  });
});
