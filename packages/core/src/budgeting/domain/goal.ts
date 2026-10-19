import { parseCurrency, type CurrencyCode } from '../../shared-kernel/currency';
import type { Id } from '../../shared-kernel/id';
import { dayOf, monthOf, yearOf, type LocalDate } from '../../shared-kernel/local-date';
import { MAX_MINOR } from '../../shared-kernel/money';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { FieldValue, RecordState } from '../../sync/domain/merge';
import { cleanName } from '../../ledger/domain/account';
import { Fields } from '../../ledger/domain/records';
import { GOAL_FIELD, TABLE } from '../../ledger/domain/tables';

export const MAX_GOAL_NAME = 80;

export interface GoalFields {
  readonly name: string;
  readonly icon: string | null;
  readonly color: number;
  readonly targetMinor: bigint;
  readonly currency: CurrencyCode;
  readonly targetLocalDate: LocalDate;
  /** A goal account (kind `goal`), one goal per account. */
  readonly accountId: Id;
}

export interface Goal extends GoalFields {
  readonly id: Id;
}

export interface NewGoalInput {
  readonly name: string;
  readonly icon?: string | null;
  readonly color?: number;
  readonly targetMinor: bigint;
  readonly currency: string;
  readonly targetLocalDate: LocalDate;
  readonly accountId: Id;
}

export type GoalError = DomainError<'invalid_goal_name' | 'invalid_target' | 'unknown_currency'>;

export function validateGoal(input: NewGoalInput): Result<GoalFields, GoalError> {
  const name = cleanName(input.name, MAX_GOAL_NAME);
  if (name === undefined) return err('invalid_goal_name', `A goal name has 1 to ${MAX_GOAL_NAME} characters and no line breaks`);
  if (input.targetMinor <= 0n || input.targetMinor > MAX_MINOR) return err('invalid_target', 'The target is more than zero');
  const currency = parseCurrency(input.currency);
  if (!currency.ok) return currency;
  return ok({
    name, icon: input.icon ?? null, color: input.color ?? 0, targetMinor: input.targetMinor, currency: currency.value,
    targetLocalDate: input.targetLocalDate, accountId: input.accountId,
  });
}

export function goalFieldPatch(changes: Partial<GoalFields>): Map<number, FieldValue> {
  const f = new Map<number, FieldValue>();
  if (changes.name !== undefined) f.set(GOAL_FIELD.name, changes.name);
  if (changes.icon !== undefined) f.set(GOAL_FIELD.icon, changes.icon);
  if (changes.color !== undefined) f.set(GOAL_FIELD.color, BigInt(changes.color));
  if (changes.targetMinor !== undefined) f.set(GOAL_FIELD.targetMinor, changes.targetMinor);
  if (changes.currency !== undefined) f.set(GOAL_FIELD.currency, changes.currency);
  if (changes.targetLocalDate !== undefined) f.set(GOAL_FIELD.targetLocalDate, BigInt(changes.targetLocalDate));
  if (changes.accountId !== undefined) f.set(GOAL_FIELD.accountId, changes.accountId);
  return f;
}

export function decodeGoal(rec: Id, state: RecordState): Goal | undefined {
  if (state.table !== TABLE.goal) return undefined;
  const f = new Fields(state);
  const name = f.text(GOAL_FIELD.name);
  const targetMinor = f.big(GOAL_FIELD.targetMinor);
  const currencyText = f.text(GOAL_FIELD.currency);
  const currency = currencyText === undefined ? undefined : parseCurrency(currencyText);
  const date = f.int(GOAL_FIELD.targetLocalDate, 0);
  const accountId = f.id(GOAL_FIELD.accountId);
  if (name === undefined || targetMinor === undefined || currency === undefined || !currency.ok || date === 0 || accountId == null) return undefined;
  return {
    id: rec, name, icon: f.nullableText(GOAL_FIELD.icon) ?? null, color: f.int(GOAL_FIELD.color, 0), targetMinor, currency: currency.value,
    targetLocalDate: date as LocalDate, accountId,
  };
}

// ---------------------------------------------------------------- progress

export type GoalStatus = 'active' | 'achieved' | 'overdue';

export interface GoalProgress {
  readonly savedMinor: bigint;
  readonly remainingMinor: bigint;
  /** Whole percent of the target saved, 0 to 100 (rounded down), for display. */
  readonly percent: number;
  readonly status: GoalStatus;
  readonly monthsLeft: number;
  /** `ceil(remaining / months_left)` in the goal's smallest currency unit; zero once achieved. */
  readonly requiredPerMonthMinor: bigint;
}

/**
 * Whole months from `today` to `target`, counting a month only once its day-of-month has been reached, and at least
 * one so the monthly saving is always defined (ARCH 4.3).
 */
export function monthsLeft(today: LocalDate, target: LocalDate): number {
  if (target <= today) return 1;
  let months = (yearOf(target) - yearOf(today)) * 12 + (monthOf(target) - monthOf(today));
  if (dayOf(target) < dayOf(today)) months -= 1;
  return months < 1 ? 1 : months;
}

export const ceilDivBig = (n: bigint, d: bigint): bigint => (n + d - 1n) / d;

/** Progress from the saved amount already expressed in the goal's currency. */
export function goalProgress(goal: Pick<Goal, 'targetMinor' | 'targetLocalDate'>, savedMinor: bigint, today: LocalDate): GoalProgress {
  const achieved = savedMinor >= goal.targetMinor;
  const remainingMinor = achieved ? 0n : goal.targetMinor - savedMinor;
  const status: GoalStatus = achieved ? 'achieved' : today > goal.targetLocalDate ? 'overdue' : 'active';
  const months = monthsLeft(today, goal.targetLocalDate);
  const saved = savedMinor < 0n ? 0n : savedMinor;
  const percent = achieved ? 100 : Number((saved * 100n) / goal.targetMinor);
  return { savedMinor, remainingMinor, percent, status, monthsLeft: months, requiredPerMonthMinor: ceilDivBig(remainingMinor, BigInt(months)) };
}
