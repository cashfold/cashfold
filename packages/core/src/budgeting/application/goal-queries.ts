import type { CurrencyCode } from '../../shared-kernel/currency';
import type { Id } from '../../shared-kernel/id';
import { fromEpochMs, type LocalDate } from '../../shared-kernel/local-date';
import type { QueryDef } from '../../sync/application/buses';
import { isVisible, type FoldState } from '../../sync/domain/merge';
import type { ClockPort } from '../../sync/ports/index';
import { accountBalance } from '../../ledger/application/balance';
import type { LedgerViews } from '../../ledger/application/views';
import { TABLE } from '../../ledger/domain/tables';
import { compareText } from '../../ledger/domain/util';
import { decodeGoal, goalProgress, type Goal, type GoalProgress } from '../domain/goal';
import { Converter } from './budget-period';

/** All visible goals of a Fold, by name then id. */
export function buildGoals(records: FoldState): ReadonlyMap<Id, Goal> {
  const list: Goal[] = [];
  for (const [rec, state] of records) {
    if (state.table !== TABLE.goal || !isVisible(state)) continue;
    const g = decodeGoal(rec, state);
    if (g !== undefined) list.push(g);
  }
  list.sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id));
  return new Map(list.map((g) => [g.id, g]));
}

export interface GoalRow {
  readonly goal: Goal;
  readonly accountName: string | undefined;
  /** Undefined when the account is gone, its balance does not fit, or a needed exchange rate is missing. */
  readonly progress: GoalProgress | undefined;
  readonly missingRates: readonly CurrencyCode[];
}

export function createGoalQueries({ views, clock }: { views: LedgerViews; clock: ClockPort }) {
  /** Saved is the goal account's posted balance today, converted to the goal's currency when they differ (FR-068). */
  const goalProgressQuery: QueryDef<{ fold: Id; tzOffsetMin?: number; today?: LocalDate }, GoalRow[]> = {
    name: 'goalProgress', requires: 'viewer', foldOf: (q) => q.fold,
    async read(q, ctx) {
      const [view, records] = await Promise.all([views.get(q.fold, ctx.reader), ctx.reader.listRecords(q.fold)]);
      const today = q.today ?? fromEpochMs(clock.nowMs(), q.tzOffsetMin ?? 0);
      return [...buildGoals(records).values()].map((goal): GoalRow => {
        const account = view.ledger.accounts.get(goal.accountId);
        if (account === undefined) return { goal, accountName: undefined, progress: undefined, missingRates: [] };
        const balance = accountBalance(view.ledger, goal.accountId, today);
        if (!balance.ok) return { goal, accountName: account.name, progress: undefined, missingRates: [] };
        const converter = new Converter(view.ledger, goal.currency);
        const saved = converter.amount(balance.value, account.currency, today);
        return {
          goal, accountName: account.name, progress: saved === undefined ? undefined : goalProgress(goal, saved, today), missingRates: [...converter.missing].sort(),
        };
      });
    },
  };
  return { goalProgress: goalProgressQuery };
}
