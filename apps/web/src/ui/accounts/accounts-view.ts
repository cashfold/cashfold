import type { AccountGroup, AccountRow, BudgetRow, Id } from '@cashfold/core';
import type { AccountsViewChoice } from '../prefs/schema';

/** What the page shows: the stored choice, or on `auto` the group view once some account (archived or not) is in a group that exists. */
export function effectiveView(pref: AccountsViewChoice, accounts: readonly AccountRow[], groups: readonly AccountGroup[]): 'group' | 'type' {
  if (pref !== 'auto') return pref;
  return accounts.some((a) => groups.some((g) => a.groupIds.includes(g.id))) ? 'group' : 'type';
}

export interface BudgetUsingGroup {
  readonly name: string;
  /** True when the group is the budget's only live limit, so deleting it leaves the budget counting nothing. */
  readonly countsNothing: boolean;
}

/** The budgets limited to a group, for the delete confirmation. */
export function budgetsUsingGroup(rows: readonly BudgetRow[], groupId: Id, liveGroupIds: readonly Id[]): BudgetUsingGroup[] {
  return rows
    .filter((r) => r.budget.scope.groupIds.includes(groupId))
    .map((r) => ({
      name: r.budget.name,
      countsNothing: r.budget.scope.accountIds.length === 0 && r.budget.scope.groupIds.every((g) => g === groupId || !liveGroupIds.includes(g)),
    }));
}
