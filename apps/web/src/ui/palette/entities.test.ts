import type { AccountGroup, AccountRow, BudgetRow, GoalRow } from '@cashfold/core';
import { describe, expect, it, vi } from 'vitest';
import { accountEntries, budgetEntries, commandEntries, goalEntries } from './entities';
import type { Command, PaletteContext } from './registry';

const ctx = () => {
  const navigate = vi.fn<(href: string) => void>();
  const context: PaletteContext = { navigate, openAdd: vi.fn(), lock: vi.fn(), toggleTheme: vi.fn(), openSignOut: vi.fn(), openHelp: vi.fn(), privacy: false, togglePrivacy: vi.fn(), accounts: 2, foldId: 'f1' };
  return Object.assign(context, { calls: navigate.mock.calls });
};
const account = (id: string, name: string, over: Record<string, unknown> = {}): AccountRow => ({ id, name, currency: 'EUR', archived: false, groupIds: [], ...over }) as unknown as AccountRow;
const group = (id: string, name: string): AccountGroup => ({ id, name, icon: null, color: 0, sortOrder: 0 }) as unknown as AccountGroup;

describe('account entries', () => {
  it('has an opaque id, the name, the currency, and opens the account\'s transactions', () => {
    const [entry] = accountEntries([account('a1', 'Checking')], [], false);
    expect(entry).toMatchObject({ id: 'a:a1', type: 'account', title: 'Checking', secondary: 'EUR' });
    const c = ctx();
    entry!.run(c);
    expect(c.calls).toEqual([['/transactions/?account=a1']]);
  });

  it('tells two accounts with one name apart by group and currency', () => {
    const entries = accountEntries(
      [account('a1', 'Savings', { groupIds: ['g1'] }), account('a2', 'Savings', { currency: 'USD', groupIds: ['g2'] })],
      [group('g1', 'Family'), group('g2', 'Work')],
      false,
    );
    expect(entries.map((e) => e.secondary)).toEqual(['Family · EUR', 'Work · USD']);
  });

  it('lists archived accounts only while the Accounts screen shows them', () => {
    const accounts = [account('a1', 'Open'), account('a2', 'Closed', { archived: true })];
    expect(accountEntries(accounts, [], false).map((e) => e.title)).toEqual(['Open']);
    expect(accountEntries(accounts, [], true).map((e) => e.title)).toEqual(['Open', 'Closed']);
  });
});

describe('budget and goal entries', () => {
  it('opens the Plan tab with the row to focus', () => {
    const [budget] = budgetEntries([{ budget: { id: 'b1', name: 'Groceries', currency: 'EUR' } } as unknown as BudgetRow]);
    const [goal] = goalEntries([{ goal: { id: 'g1', name: 'Holiday', currency: 'EUR' }, accountName: 'Holiday pot' } as unknown as GoalRow]);
    expect(budget).toMatchObject({ id: 'e:b1', type: 'envelope', title: 'Groceries', secondary: 'EUR' });
    expect(goal).toMatchObject({ id: 'g:g1', type: 'goal', title: 'Holiday', secondary: 'Holiday pot · EUR' });
    const c = ctx();
    budget!.run(c);
    goal!.run(c);
    expect(c.calls).toEqual([['/plan/?view=budgets&item=b1'], ['/plan/?view=goals&item=g1']]);
  });

  it('shows only the currency for a goal whose account is gone', () => {
    const [goal] = goalEntries([{ goal: { id: 'g1', name: 'Old', currency: 'USD' }, accountName: undefined } as unknown as GoalRow]);
    expect(goal!.secondary).toBe('USD');
  });

  it('builds nothing from nothing, so a failed read leaves accounts and screens usable', () => {
    expect(budgetEntries([])).toEqual([]);
    expect(goalEntries([])).toEqual([]);
  });
});

describe('command entries', () => {
  it('translates the title and the keywords and runs the command', () => {
    const run = vi.fn();
    const command: Command = { id: 'go-plan', titleKey: 'nav.plan', keywordKeys: ['k.plan'], group: 'screen', run };
    const t = (key: string) => `<${key}>`;
    const [entry] = commandEntries([command], t);
    expect(entry).toMatchObject({ id: 'c:go-plan', type: 'screen', title: '<nav.plan>', keywords: ['<k.plan>'] });
    const c = ctx();
    entry!.run(c);
    expect(run).toHaveBeenCalledWith(c);
  });
});
