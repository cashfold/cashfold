import { describe, expect, it } from 'vitest';
import { resetAccountPrefs } from './reset-account';
import { DEFAULT_PREFS, type Prefs } from './schema';

const mine: Prefs = {
  ...DEFAULT_PREFS,
  theme: 'dark', language: 'uk', moreDetailsOpen: true, optionalFields: { 'tx.note': true },
  overview: { period: { kind: 'last90' }, collapsed: ['trend'] }, plan: { view: 'goals' },
  recents: { account: { f1: 'a1' }, categories: { f1: ['c1', 'c2'] } },
  hints: { dismissed: ['folds-sharing'] }, firstRun: { dismissed: true }, lists: { showArchivedAccounts: true },
};

describe('what the interface preferences forget when an account is signed out (spec 011)', () => {
  it('forgets the Fold-keyed recents and that the Getting started card was hidden, which belong to the account', () => {
    const r = resetAccountPrefs(mine);
    expect(r.recents).toEqual(DEFAULT_PREFS.recents);
    expect(r.firstRun).toEqual(DEFAULT_PREFS.firstRun);
  });

  it('keeps what belongs to the device: language, theme, layout choices and dismissed hints', () => {
    const r = resetAccountPrefs(mine);
    expect(r.theme).toBe('dark');
    expect(r.language).toBe('uk');
    expect(r.moreDetailsOpen).toBe(true);
    expect(r.optionalFields).toEqual({ 'tx.note': true });
    expect(r.overview).toEqual(mine.overview);
    expect(r.plan).toEqual({ view: 'goals' });
    expect(r.hints).toEqual({ dismissed: ['folds-sharing'] });
    expect(r.lists).toEqual({ showArchivedAccounts: true });
  });

  it('does not change its input', () => {
    const before = JSON.stringify(mine);
    resetAccountPrefs(mine);
    expect(JSON.stringify(mine)).toBe(before);
  });
});
