import type { AccountGroup, AccountRow, CurrencyCode, Id } from '@cashfold/core';
import { ACCOUNT_KINDS } from '@cashfold/core';
import { describe, expect, it } from 'vitest';
import { accountSections, groupOf } from './account-sections';

const asId = (s: string) => s as Id;
const cur = (c: string) => c as CurrencyCode;
const group = (id: string, sortOrder = 0): AccountGroup => ({ id: asId(id), name: id.toUpperCase(), icon: null, color: 0, sortOrder });
const account = (id: string, { groupIds = [], currency = 'USD', ...over }: Partial<Omit<AccountRow, 'groupIds' | 'currency'>> & { groupIds?: string[]; currency?: string } = {}): AccountRow => ({
  id: asId(id), groupIds: groupIds.map(asId), currency: cur(currency), kind: 'checking', name: id, openingBalanceMinor: 0n, openingDate: 0 as never, includeInNetWorth: true, creditLimitMinor: null,
  icon: null, color: 0, sortOrder: 0, archived: false, balanceMinor: 0n, ...over,
} as unknown as AccountRow);

describe('groupOf', () => {
  const groups = [group('g1'), group('g2'), group('g3')];

  it('is the first of the account\'s groups that is in the groups, in the order of the groups', () => {
    expect(groupOf(account('a', { groupIds: ['g3', 'g2'] }), groups)?.id).toBe('g2');
    expect(groupOf(account('a', { groupIds: ['g2', 'g1'] }), groups)?.id).toBe('g1');
  });

  it('is undefined for an account with no group, or only groups that are gone', () => {
    expect(groupOf(account('a'), groups)).toBeUndefined();
    expect(groupOf(account('a', { groupIds: ['gone'] }), groups)).toBeUndefined();
  });
});

describe('accountSections in the group view', () => {
  const groups = [group('g1'), group('g2')];

  it('has one section per group in order, then Ungrouped only when some listed account has no group', () => {
    const a = [account('a', { groupIds: ['g2'] }), account('b', { groupIds: ['g1'] }), account('c')];
    const s = accountSections({ accounts: a, groups, view: 'group' });
    expect(s.map((x) => [x.kind, x.group?.id, x.accounts.map((y) => y.id)])).toEqual([
      ['group', 'g1', ['b']], ['group', 'g2', ['a']], ['ungrouped', undefined, ['c']],
    ]);
    const all = accountSections({ accounts: a.slice(0, 2), groups, view: 'group' });
    expect(all.map((x) => x.kind)).toEqual(['group', 'group']);
  });

  it('lists an account in two groups once, under the earlier group', () => {
    const s = accountSections({ accounts: [account('a', { groupIds: ['g2', 'g1'] })], groups, view: 'group' });
    expect(s.map((x) => x.accounts.length)).toEqual([1, 0]);
    expect(s[0]!.group!.id).toBe('g1');
  });

  it('keeps a group with no listed accounts as an empty section with no totals', () => {
    const s = accountSections({ accounts: [], groups, view: 'group' });
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ accounts: [], totals: undefined });
  });

  it('adds balances per currency in code order, as bigint, with negatives subtracting', () => {
    const a = [
      account('a', { groupIds: ['g1'], currency: 'USD', balanceMinor: 1000n }),
      account('b', { groupIds: ['g1'], currency: 'EUR', balanceMinor: 250n }),
      account('c', { groupIds: ['g1'], currency: 'USD', balanceMinor: -400n }),
      account('d', { groupIds: ['g1'], currency: 'EUR', balanceMinor: 9007199254740993n }),
    ];
    const [first] = accountSections({ accounts: a, groups, view: 'group' });
    expect(first!.totals).toEqual([{ currency: cur('EUR'), minor: 9007199254741243n }, { currency: cur('USD'), minor: 600n }]);
  });

  it('is unavailable when any account in the section has no balance', () => {
    const a = [account('a', { groupIds: ['g1'], balanceMinor: 5n }), account('b', { groupIds: ['g1'], balanceMinor: null })];
    expect(accountSections({ accounts: a, groups, view: 'group' })[0]!.totals).toBe('unavailable');
  });

  it('has Ungrouped totals too', () => {
    const s = accountSections({ accounts: [account('a', { balanceMinor: 7n })], groups: [], view: 'group' });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: 'ungrouped', totals: [{ currency: cur('USD'), minor: 7n }] });
  });
});

describe('accountSections in the type view', () => {
  it('has one section per kind that has accounts, in ACCOUNT_KINDS order, keeping the given order and with no totals', () => {
    const a = [account('a', { kind: 'savings' }), account('b', { kind: 'checking' }), account('c', { kind: 'savings' })];
    const s = accountSections({ accounts: a, groups: [], view: 'type' });
    expect(s.map((x) => x.accountKind)).toEqual(ACCOUNT_KINDS.filter((k) => k === 'checking' || k === 'savings'));
    expect(s.find((x) => x.accountKind === 'savings')!.accounts.map((x) => x.id)).toEqual(['a', 'c']);
    for (const x of s) expect(x).toMatchObject({ kind: 'type', totals: undefined });
  });
});

describe('accountSections in general', () => {
  it('does not change its input', () => {
    const accounts = [account('a', { groupIds: ['g1'] })];
    const groups = [group('g1')];
    const before = JSON.stringify([accounts, groups], (_k, v) => (typeof v === 'bigint' ? String(v) : v));
    accountSections({ accounts, groups, view: 'group' });
    accountSections({ accounts, groups, view: 'type' });
    expect(JSON.stringify([accounts, groups], (_k, v) => (typeof v === 'bigint' ? String(v) : v))).toBe(before);
  });

  it('builds 200 accounts in 30 groups in under 50 ms', () => {
    const groups = Array.from({ length: 30 }, (_, i) => group(`g${i}`, i));
    const accounts = Array.from({ length: 200 }, (_, i) => account(`a${i}`, { groupIds: [`g${i % 31}`], balanceMinor: BigInt(i) }));
    const start = performance.now();
    accountSections({ accounts, groups, view: 'group' });
    expect(performance.now() - start).toBeLessThan(50);
  });
});
