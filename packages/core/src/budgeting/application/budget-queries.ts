import type { Id } from '../../shared-kernel/id';
import type { LocalDate } from '../../shared-kernel/local-date';
import type { QueryDef } from '../../sync/application/buses';
import type { LedgerViews } from '../../ledger/application/views';
import type { ClockPort } from '../../sync/ports/index';
import { fromEpochMs } from '../../shared-kernel/local-date';
import type { Budget } from '../domain/budget';
import { budgetPeriodAt, budgetPeriodOn, buildBudgets, type BudgetPeriodView } from './budget-period';
import { velocity, type Velocity } from './velocity';

export interface BudgetRow {
  readonly budget: Budget;
  /** The period containing today; undefined before the budget starts or after a custom period ended. */
  readonly period: BudgetPeriodView | undefined;
  readonly velocity: Velocity | undefined;
}

export interface BudgetDetail extends BudgetRow {
  readonly today: LocalDate;
}

export interface BudgetQueryDeps {
  readonly views: LedgerViews;
  readonly clock: ClockPort;
}

export function createBudgetQueries({ views, clock }: BudgetQueryDeps) {
  const todayOf = (): LocalDate => fromEpochMs(clock.nowMs(), 0);

  const rowFor = (ledgerView: Awaited<ReturnType<LedgerViews['get']>>, budget: Budget, today: LocalDate, index?: number): BudgetRow => {
    const period = index === undefined ? budgetPeriodOn(ledgerView.ledger, budget, today) : budgetPeriodAt(ledgerView.ledger, budget, index);
    return { budget, period, velocity: period === undefined ? undefined : velocity(period, budget.direction, today) };
  };

  const listBudgets: QueryDef<{ fold: Id; on?: LocalDate }, BudgetRow[]> = {
    name: 'listBudgets',
    requires: 'viewer',
    foldOf: (q) => q.fold,
    async read(q, ctx) {
      const [view, records] = await Promise.all([views.get(q.fold, ctx.reader), ctx.reader.listRecords(q.fold)]);
      const today = q.on ?? todayOf();
      return [...buildBudgets(records).values()].map((b) => rowFor(view, b, today));
    },
  };

  /** One budget at a period (the current one unless `index` is given). */
  const budgetDetail: QueryDef<{ fold: Id; id: Id; index?: number; on?: LocalDate }, BudgetDetail | undefined> = {
    name: 'budgetDetail',
    requires: 'viewer',
    foldOf: (q) => q.fold,
    async read(q, ctx) {
      const [view, records] = await Promise.all([views.get(q.fold, ctx.reader), ctx.reader.listRecords(q.fold)]);
      const budget = buildBudgets(records).get(q.id);
      if (budget === undefined) return undefined;
      const today = q.on ?? todayOf();
      return { ...rowFor(view, budget, today, q.index), today };
    },
  };

  return { listBudgets, budgetDetail };
}
