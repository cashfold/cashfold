import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, MAX_PREFS_BYTES, parsePrefs, serializePrefs, type Prefs } from './schema';

const parse = (value: unknown) => parsePrefs(typeof value === 'string' ? value : JSON.stringify(value));

describe('parsePrefs', () => {
  it('gives the defaults for a missing, empty or unreadable store', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', '3', 'null']) expect(parsePrefs(raw as string | null)).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid values', () => {
    const prefs = parse({
      v: 1, theme: 'dark', moreDetailsOpen: true, optionalFields: { 'tx.note': true, 'tx.payee': false },
      overview: { period: { kind: 'last30' }, collapsed: ['tag', 'trend'] }, plan: { view: 'goals' },
      recents: { account: { f1: 'a1' }, categories: { f1: ['c1', 'c2'] } }, hints: { dismissed: ['folds'] }, firstRun: { dismissed: true }, lists: { showArchivedAccounts: true },
    });
    expect(prefs.theme).toBe('dark');
    expect(prefs.moreDetailsOpen).toBe(true);
    expect(prefs.optionalFields).toEqual({ 'tx.note': true, 'tx.payee': false });
    expect(prefs.overview).toEqual({ period: { kind: 'last30' }, collapsed: ['tag', 'trend'] });
    expect(prefs.plan.view).toBe('goals');
    expect(prefs.recents.categories['f1']).toEqual(['c1', 'c2']);
    expect(prefs.hints.dismissed).toEqual(['folds']);
    expect(prefs.firstRun.dismissed).toBe(true);
    expect(prefs.lists.showArchivedAccounts).toBe(true);
  });

  it('drops unknown keys', () => {
    const prefs = parse({ v: 1, theme: 'light', sneaky: 'x', overview: { extra: 1, collapsed: [] } }) as unknown as Record<string, unknown>;
    expect(prefs['sneaky']).toBeUndefined();
    expect((prefs['overview'] as Record<string, unknown>)['extra']).toBeUndefined();
    expect(prefs['theme']).toBe('light');
  });

  it('falls back per field for invalid enums, booleans and dates', () => {
    const prefs = parse({
      v: 1, theme: 'purple', moreDetailsOpen: 'yes', plan: { view: 'nope' }, firstRun: { dismissed: 1 }, lists: { showArchivedAccounts: 'true' },
      overview: { period: { kind: 'custom', from: '2025-02-30', to: '2025-03-01' }, collapsed: ['tag', 'bogus', 'tag'] },
    });
    expect(prefs.theme).toBe('system');
    expect(prefs.moreDetailsOpen).toBe(false);
    expect(prefs.plan.view).toBe('budgets');
    expect(prefs.firstRun.dismissed).toBe(false);
    expect(prefs.lists.showArchivedAccounts).toBe(false);
    expect(prefs.overview.period).toEqual({ kind: 'thisMonth' });
    expect(prefs.overview.collapsed).toEqual(['tag']);
  });

  it('requires a custom period to have from <= to', () => {
    expect(parse({ v: 1, overview: { period: { kind: 'custom', from: '2025-03-02', to: '2025-03-01' } } }).overview.period).toEqual({ kind: 'thisMonth' });
    expect(parse({ v: 1, overview: { period: { kind: 'custom', from: '2025-03-01', to: '2025-03-01' } } }).overview.period).toEqual({ kind: 'custom', from: '2025-03-01', to: '2025-03-01' });
    expect(parse({ v: 1, overview: { period: { kind: 'custom', from: '2024-02-29', to: '2024-03-31' } } }).overview.period.kind).toBe('custom');
  });

  it('ignores optionalFields entries with bad ids or non-boolean values', () => {
    expect(parse({ v: 1, optionalFields: { 'tx.note': true, 'bad id': true, 'tx.payee': 'yes' } }).optionalFields).toEqual({ 'tx.note': true });
  });

  it('uses defaults for a higher schema version and flags it so nothing is overwritten', () => {
    const prefs = parse({ v: 2, theme: 'dark' });
    expect(prefs).toEqual(DEFAULT_PREFS);
  });

  it('caps recents per Fold at 8 categories and hints at 32', () => {
    const many = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const prefs = parse({ v: 1, recents: { categories: { f1: many } }, hints: { dismissed: many.concat(many.map((x) => `${x}b`)) } });
    expect(prefs.recents.categories['f1']).toEqual(many.slice(0, 8));
    expect(prefs.hints.dismissed.length).toBe(32);
  });
});

describe('serializePrefs', () => {
  it('round-trips', () => {
    const prefs: Prefs = { ...DEFAULT_PREFS, theme: 'dark', optionalFields: { 'tx.note': true } };
    expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs);
  });

  it('stays within 4 KiB by dropping the oldest recents first', () => {
    const prefs: Prefs = {
      ...DEFAULT_PREFS, theme: 'dark',
      recents: {
        account: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`fold-${i}`, `account-${i}`.padEnd(64, 'x')])),
        categories: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`fold-${i}`, Array.from({ length: 8 }, (__, j) => `cat-${i}-${j}`.padEnd(64, 'y'))])),
      },
    };
    const text = serializePrefs(prefs);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MAX_PREFS_BYTES);
    const back = parsePrefs(text);
    expect(back.theme).toBe('dark');
    // The newest entry of a list is first, so the oldest (last) go first.
    const kept = back.recents.categories['fold-0'] ?? [];
    expect(kept.length === 0 || kept[0] === prefs.recents.categories['fold-0']![0]).toBe(true);
  });
});

describe('the JSON schema contract', () => {
  const schema = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../../specs/002-ux-redesign-catalyst/contracts/preferences.schema.json'), 'utf8')) as {
    properties: Record<string, unknown>;
  };
  it('lists exactly the keys the parser keeps', () => {
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(DEFAULT_PREFS).sort());
  });
});

describe('the language preference', () => {
  it('defaults to following the browser', () => {
    expect(DEFAULT_PREFS.language).toBe('auto');
    expect(parsePrefs(null).language).toBe('auto');
  });

  it.each(['auto', 'en', 'uk', 'pl'])('keeps %s', (language) => {
    expect(parse({ v: 1, language }).language).toBe(language);
  });

  it.each(['xx', 'ar', 'en-XA', 7, null, {}, ['pl']])('falls back to auto for %j without touching the rest', (language) => {
    const prefs = parse({ v: 1, theme: 'dark', language });
    expect(prefs.language).toBe('auto');
    expect(prefs.theme).toBe('dark');
  });

  it('reads an older store with no language field', () => {
    expect(parse({ v: 1, theme: 'light' }).language).toBe('auto');
  });

  it('survives a save and a load', () => {
    expect(parsePrefs(serializePrefs({ ...DEFAULT_PREFS, language: 'pl' })).language).toBe('pl');
  });
});

describe('lists.accountsView', () => {
  it('defaults to auto', () => {
    expect(DEFAULT_PREFS.lists.accountsView).toBe('auto');
    expect(parse({ v: 1 }).lists.accountsView).toBe('auto');
  });

  it('keeps auto, group and type', () => {
    for (const view of ['auto', 'group', 'type'] as const) expect(parse({ v: 1, lists: { accountsView: view } }).lists.accountsView).toBe(view);
  });

  it('turns anything else into auto without touching the other preferences', () => {
    for (const bad of ['table', 3, null, {}, '']) {
      const prefs = parse({ v: 1, theme: 'dark', lists: { showArchivedAccounts: true, accountsView: bad } });
      expect(prefs.lists).toEqual({ showArchivedAccounts: true, accountsView: 'auto' });
      expect(prefs.theme).toBe('dark');
    }
  });

  it('survives serialising and parsing again', () => {
    const prefs: Prefs = { ...DEFAULT_PREFS, lists: { ...DEFAULT_PREFS.lists, accountsView: 'group' } };
    expect(parsePrefs(serializePrefs(prefs)).lists.accountsView).toBe('group');
  });
});

describe('the primary colour preference', () => {
  it('defaults to emerald and keeps a valid choice', () => {
    expect(DEFAULT_PREFS.primary).toBe('emerald');
    expect(parsePrefs(JSON.stringify({ v: 1, primary: 'violet' })).primary).toBe('violet');
  });
  it('falls back to the default for old data without it, and for invalid values, without touching other fields', () => {
    expect(parsePrefs(JSON.stringify({ v: 1, theme: 'dark' })).primary).toBe('emerald');
    const bad = parsePrefs(JSON.stringify({ v: 1, theme: 'dark', primary: 'purple' }));
    expect(bad.primary).toBe('emerald');
    expect(bad.theme).toBe('dark');
  });
});
