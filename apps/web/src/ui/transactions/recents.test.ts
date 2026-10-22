import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, type Prefs } from '../prefs/schema';
import { orderCategories, pickDefaultAccount, pruneRecents, recordRecents } from './recents';

const prefs = (recents: Prefs['recents']): Pick<Prefs, 'recents'> => ({ recents });
const account = (id: string, extra: { archived?: boolean; kind?: string } = {}) => ({ id, archived: false, kind: 'checking', ...extra });
const category = (id: string, parentId: string | null = null, extra: { archived?: boolean } = {}) => ({ id, parentId, archived: false, name: id, ...extra });

describe('pickDefaultAccount', () => {
  const accounts = [account('a1'), account('a2'), account('goal', { kind: 'goal' }), account('old', { archived: true })];

  it('prefers the account last used in this Fold', () => {
    expect(pickDefaultAccount(prefs({ account: { f1: 'a2' }, categories: {} }), 'f1', accounts)).toBe('a2');
  });
  it('falls back to the first ordinary account when nothing was used', () => {
    expect(pickDefaultAccount(prefs({ account: {}, categories: {} }), 'f1', accounts)).toBe('a1');
  });
  it('ignores a remembered account that no longer exists or is archived or belongs to another Fold', () => {
    expect(pickDefaultAccount(prefs({ account: { f1: 'gone' }, categories: {} }), 'f1', accounts)).toBe('a1');
    expect(pickDefaultAccount(prefs({ account: { f1: 'old' }, categories: {} }), 'f1', accounts)).toBe('a1');
    expect(pickDefaultAccount(prefs({ account: { f2: 'a2' }, categories: {} }), 'f1', accounts)).toBe('a1');
  });
  it('skips goal accounts unless they are all there is', () => {
    expect(pickDefaultAccount(prefs({ account: {}, categories: {} }), 'f1', [account('goal', { kind: 'goal' }), account('a1')])).toBe('a1');
    expect(pickDefaultAccount(prefs({ account: {}, categories: {} }), 'f1', [account('goal', { kind: 'goal' })])).toBe('goal');
  });
  it('gives nothing when there are no usable accounts', () => {
    expect(pickDefaultAccount(DEFAULT_PREFS, 'f1', [])).toBeUndefined();
    expect(pickDefaultAccount(DEFAULT_PREFS, 'f1', [account('old', { archived: true })])).toBeUndefined();
  });
});

describe('orderCategories', () => {
  const all = [category('food'), category('cafe', 'food'), category('rent'), category('fun'), category('cinema', 'fun'), category('old', null, { archived: true })];

  it('puts recently used categories first, newest first, then the parents with their children', () => {
    const out = orderCategories(['fun', 'cafe'], all);
    expect(out.recent.map((c) => c.id)).toEqual(['fun', 'cafe']);
    expect(out.groups.map((g) => g.root.id)).toEqual(['food', 'rent', 'fun']);
    expect(out.groups[0]!.children.map((c) => c.id)).toEqual(['cafe']);
  });
  it('ignores ids that no longer exist or are archived', () => {
    const out = orderCategories(['gone', 'old', 'rent'], all);
    expect(out.recent.map((c) => c.id)).toEqual(['rent']);
  });
  it('shows no recent group when nothing was used', () => {
    expect(orderCategories([], all).recent).toEqual([]);
  });
  it('keeps an archived category the entry already has so it is not lost on edit', () => {
    const out = orderCategories([], all, 'old');
    expect(out.groups.map((g) => g.root.id)).toContain('old');
  });
});

describe('recordRecents / pruneRecents', () => {
  it('records the account and moves the category to the front, capped at eight', () => {
    let r: Prefs['recents'] = { account: {}, categories: {} };
    for (let i = 1; i <= 10; i++) r = recordRecents(r, 'f1', 'a1', `c${i}`);
    expect(r.account['f1']).toBe('a1');
    expect(r.categories['f1']).toHaveLength(8);
    expect(r.categories['f1']![0]).toBe('c10');
    r = recordRecents(r, 'f1', 'a1', 'c5');
    expect(r.categories['f1']![0]).toBe('c5');
    expect(new Set(r.categories['f1']).size).toBe(8);
  });
  it('records no category when the entry has none', () => {
    expect(recordRecents({ account: {}, categories: {} }, 'f1', 'a1', null).categories).toEqual({});
  });
  it('prunes ids that are not in the Fold any more', () => {
    const pruned = pruneRecents({ account: { f1: 'a1' }, categories: { f1: ['c1', 'c2', 'x'] } }, 'f1', new Set(['a1']), new Set(['c1', 'c2']));
    expect(pruned.categories['f1']).toEqual(['c1', 'c2']);
    expect(pruneRecents({ account: { f1: 'gone' }, categories: {} }, 'f1', new Set(['a1']), new Set()).account).toEqual({});
  });
});
