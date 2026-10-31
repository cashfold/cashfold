import type { AccountGroup, AccountRow, BudgetRow, GoalRow } from '@cashfold/core';
import type { Translate } from '../i18n/i18n';
import type { PaletteEntry } from './entry';
import type { Command } from './registry';

// The rows the palette builds on open (contracts/ui-contract.md §3 and §4). Accounts come from the ledger state already in memory; budgets and goals
// from the two queries the Plan screen already uses. Only the viewed Fold is ever passed in, so another Fold's names never get here.

/** An account row. Archived accounts are listed only while the Accounts screen shows them. */
export function accountEntries(accounts: readonly AccountRow[], groups: readonly AccountGroup[], showArchived: boolean): PaletteEntry[] {
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  return accounts
    .filter((a) => showArchived || !a.archived)
    .map((a) => {
      const group = a.groupIds.map((id) => groupName.get(id)).find((name) => name !== undefined);
      return {
        id: `a:${a.id}`,
        type: 'account' as const,
        title: a.name,
        secondary: group === undefined ? a.currency : `${group} · ${a.currency}`,
        keywords: [],
        run: (ctx) => ctx.navigate(`/transactions/?account=${encodeURIComponent(a.id)}`),
      };
    });
}

/** A budget row (the "envelope" of the spec). It opens the Plan screen on the Budgets tab with that row focused. */
export function budgetEntries(rows: readonly BudgetRow[]): PaletteEntry[] {
  return rows.map(({ budget }) => ({
    id: `e:${budget.id}`,
    type: 'envelope' as const,
    title: budget.name,
    secondary: budget.currency,
    keywords: [],
    run: (ctx) => ctx.navigate(`/plan/?view=budgets&item=${encodeURIComponent(budget.id)}`),
  }));
}

/** A goal row. It opens the Plan screen on the Goals tab with that row focused. */
export function goalEntries(rows: readonly GoalRow[]): PaletteEntry[] {
  return rows.map(({ goal, accountName }) => ({
    id: `g:${goal.id}`,
    type: 'goal' as const,
    title: goal.name,
    ...(accountName === undefined ? { secondary: goal.currency } : { secondary: `${accountName} · ${goal.currency}` }),
    keywords: [],
    run: (ctx) => ctx.navigate(`/plan/?view=goals&item=${encodeURIComponent(goal.id)}`),
  }));
}

/** A registered screen or action, with its words in the person's language. */
export function commandEntries(commands: readonly Command[], t: Translate): PaletteEntry[] {
  return commands.map((command) => ({
    id: `c:${command.id}`,
    type: command.group,
    title: t(command.titleKey),
    keywords: (command.keywordKeys ?? []).map((key) => t(key)),
    run: (ctx) => command.run(ctx),
  }));
}
