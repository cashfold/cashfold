import type { Id } from '../../shared-kernel/id';
import type { Finding, RepairRule } from '../../sync/application/repair';
import { isVisible, type FoldState } from '../../sync/domain/merge';
import { isTombstoned } from '../../ledger/domain/records';
import { TABLE } from '../../ledger/domain/tables';
import { decodeBudget } from '../domain/budget';
import { decodeGoal } from '../domain/goal';
import { decodeAccount } from '../../ledger/domain/records';

// Deterministic post-merge repair for budgets (FR-078). Budgets are plans, not balances: nothing a merge can do to
// one corrupts money, so these rules only report, and a budget is never hidden because of a damaged scope.
//
// Concurrent rollover change: the rollover is one ordinary field, so two devices that disagree converge on the
// last writer by field clock (LWW). Periods are derived, never stored, so every replica then recomputes carry-in
// from the same transactions and shows the same numbers. There is nothing to repair; budget-period.test.ts pins it.

const finding = (kind: string, ref: Id, effect: Finding['effect']): Finding => ({ kind, ref, messageKey: `attention.${kind}`, ...(effect !== undefined && { effect }) });

function liveIds(state: FoldState, table: number): Set<Id> {
  const out = new Set<Id>();
  for (const [rec, s] of state) if (s.table === table && isVisible(s)) out.add(rec);
  return out;
}

/** A budget that watches an account, group, category or tag that was deleted (or never arrived). The missing member simply matches nothing. */
const scopeOrphan: RepairRule = {
  id: 'budgeting.scope_orphan',
  check(state) {
    const known = {
      accountIds: liveIds(state, TABLE.account), groupIds: liveIds(state, TABLE.accountGroup), categoryIds: liveIds(state, TABLE.category), tagIds: liveIds(state, TABLE.tag),
    };
    const found: Finding[] = [];
    for (const [rec, s] of state) {
      if (s.table !== TABLE.budget || !isVisible(s)) continue;
      const budget = decodeBudget(rec, s);
      if (budget === undefined) continue;
      const orphaned = (Object.keys(known) as Array<keyof typeof known>).some((key) => budget.scope[key].some((member) => !known[key].has(member)));
      const unfunded = budget.fundedFromAccountId !== null && !known.accountIds.has(budget.fundedFromAccountId);
      if (orphaned || unfunded) found.push(finding('budget_scope_orphan', rec, 'flag'));
    }
    return found;
  },
};

const malformedBudget: RepairRule = {
  id: 'budgeting.malformed_budget',
  check(state) {
    const found: Finding[] = [];
    for (const [rec, s] of state) {
      if (s.table !== TABLE.budget || isTombstoned(s)) continue;
      if (decodeBudget(rec, s) === undefined) found.push(finding('malformed_record', rec, 'hide'));
    }
    return found;
  },
};

/**
 * A goal needs a goal account of its own (FR-067). After a merge its account can be gone, not a goal account, or shared
 * with a goal that sorts before it. The goal is reported and shows no progress; the one that sorts first keeps working.
 */
const goalAccount: RepairRule = {
  id: 'budgeting.goal_account',
  check(state) {
    const kinds = new Map<Id, string>();
    for (const [rec, s] of state) {
      if (s.table !== TABLE.account || !isVisible(s)) continue;
      const a = decodeAccount(rec, s);
      if (a !== undefined) kinds.set(rec, a.kind);
    }
    const goals = [...state].filter(([, s]) => s.table === TABLE.goal && isVisible(s)).flatMap(([rec, s]) => {
      const g = decodeGoal(rec, s);
      return g === undefined ? [] : [g];
    }).sort((a, b) => (a.id < b.id ? -1 : 1));
    const found: Finding[] = [];
    const used = new Set<Id>();
    for (const g of goals) {
      if (kinds.get(g.accountId) !== 'goal') found.push(finding('goal_invalid', g.id, 'flag'));
      else if (used.has(g.accountId)) found.push(finding('goal_duplicate_account', g.id, 'flag'));
      else used.add(g.accountId);
    }
    return found;
  },
};

const malformedGoal: RepairRule = {
  id: 'budgeting.malformed_goal',
  check(state) {
    const found: Finding[] = [];
    for (const [rec, s] of state) {
      if (s.table !== TABLE.goal || isTombstoned(s)) continue;
      if (decodeGoal(rec, s) === undefined) found.push(finding('malformed_record', rec, 'hide'));
    }
    return found;
  },
};

export const budgetingRepairRules: readonly RepairRule[] = [scopeOrphan, malformedBudget, goalAccount, malformedGoal];
