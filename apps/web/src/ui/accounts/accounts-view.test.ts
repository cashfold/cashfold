import type { AccountGroup, AccountRow, BudgetRow, Id } from '@cashfold/core';
import { describe, expect, it } from 'vitest';
import { budgetsUsingGroup, effectiveView } from './accounts-view';

const asId = (s: string) => s as Id;
const group = (id: string): AccountGroup => ({ id: asId(id), name: id, icon: null, color: 0, sortOrder: 0 });
const account = (id: string, groupIds: string[] = [], archived = false) => ({ id: asId(id), groupIds: groupIds.map(asId), archived }) as unknown as AccountRow;

describe('effectiveView', () => {
  it('returns a stored group or type choice whatever the data', () => {
    expect(effectiveView('group', [], [])).toBe('group');
    expect(effectiveView('type', [account('a', ['g'])], [group('g')])).toBe('type');
  });

  it('opens by group on auto when some account, archived or not, is in a group that exists', () => {
    expect(effectiveView('auto', [account('a', ['g'])], [group('g')])).toBe('group');
    expect(effectiveView('auto', [account('a', ['g'], true)], [group('g')])).toBe('group');
  });

  it('opens by type on auto with no groups, only empty groups, or only deleted groups', () => {
    expect(effectiveView('auto', [account('a')], [])).toBe('type');
    expect(effectiveView('auto', [account('a')], [group('g')])).toBe('type');
    expect(effectiveView('auto', [account('a', ['gone'])], [group('g')])).toBe('type');
  });
});

const budget = (name: string, scope: { accountIds?: string[]; groupIds?: string[] }): BudgetRow =>
  ({ budget: { name, scope: { accountIds: [], groupIds: [], categoryIds: [], tagIds: [], includeTransfers: false, ...scope } } }) as unknown as BudgetRow;

describe('budgetsUsingGroup', () => {
  const rows = [budget('Food', { groupIds: ['g'] }), budget('Other', { groupIds: ['h'] }), budget('Mixed', { groupIds: ['g'], accountIds: ['a'] }), budget('Two', { groupIds: ['g', 'h'] }), budget('Dead', { groupIds: ['g', 'x'] })];

  it('names the budgets whose scope includes the group, in the rows\' order', () => {
    expect(budgetsUsingGroup(rows, asId('g'), ['g', 'h'].map(asId)).map((b) => b.name)).toEqual(['Food', 'Mixed', 'Two', 'Dead']);
  });

  it('is empty when none uses it or there are no rows', () => {
    expect(budgetsUsingGroup(rows, asId('zzz'), [asId('g')])).toEqual([]);
    expect(budgetsUsingGroup([], asId('g'), [asId('g')])).toEqual([]);
  });

  it('flags a budget that would count nothing: no accounts and no other live group', () => {
    const flags = Object.fromEntries(budgetsUsingGroup(rows, asId('g'), ['g', 'h'].map(asId)).map((b) => [b.name, b.countsNothing]));
    expect(flags).toEqual({ Food: true, Mixed: false, Two: false, Dead: true });
  });
});
