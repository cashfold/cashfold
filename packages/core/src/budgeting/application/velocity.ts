import { divRoundHalfEven } from '../../shared-kernel/money';
import { daysBetween, type LocalDate } from '../../shared-kernel/local-date';
import { maxOf, minOf } from '../../ledger/domain/util';
import type { BudgetDirection } from '../domain/budget';
import type { BudgetPeriodView } from './budget-period';

export interface Velocity {
  readonly daysElapsed: number;
  readonly periodDays: number;
  /** Average spent per elapsed day, rounded half to even. */
  readonly burnMinor: bigint;
  /** Spent so far scaled to the whole period, rounded half to even. */
  readonly projectedMinor: bigint;
  /** Expense budgets only: the projection exceeds what the period can spend, `carry_in + allocation` (FR-058). */
  readonly overspend: boolean;
}

/** `d_elapsed` is at least one and at most the length of the period. */
export function velocity(period: BudgetPeriodView, direction: BudgetDirection, today: LocalDate): Velocity {
  const periodDays = period.dayCount;
  const daysElapsed = minOf([periodDays], maxOf([1], daysBetween(period.from, today) + 1));
  const burnMinor = divRoundHalfEven(period.spentMinor, BigInt(daysElapsed));
  const projectedMinor = divRoundHalfEven(period.spentMinor * BigInt(periodDays), BigInt(daysElapsed));
  const overspend = direction === 'expense' && projectedMinor > period.carryInMinor + period.allocationMinor;
  return { daysElapsed, periodDays, burnMinor, projectedMinor, overspend };
}
