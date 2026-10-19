import { parseCurrency, type CurrencyCode } from '../../shared-kernel/currency';
import type { Id } from '../../shared-kernel/id';
import { addDays, addMonths, daysBetween, type LocalDate } from '../../shared-kernel/local-date';
import { MAX_MINOR } from '../../shared-kernel/money';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { FieldValue, RecordState } from '../../sync/domain/merge';
import { visibleMembers } from '../../sync/domain/merge';
import { cleanName } from '../../ledger/domain/account';
import { Fields } from '../../ledger/domain/records';
import { BUDGET_FIELD, TABLE } from '../../ledger/domain/tables';
import { maxOf } from '../../ledger/domain/util';

export const MAX_BUDGET_NAME = 80;

export const BUDGET_DIRECTIONS = ['expense', 'income'] as const;
export type BudgetDirection = (typeof BUDGET_DIRECTIONS)[number];
const DIRECTION_CODE: Readonly<Record<BudgetDirection, bigint>> = { expense: 1n, income: 2n };

export const PERIOD_UNITS = ['day', 'week', 'month', 'year', 'custom'] as const;
export type PeriodUnit = (typeof PERIOD_UNITS)[number];
const UNIT_CODE: Readonly<Record<PeriodUnit, bigint>> = { day: 1n, week: 2n, month: 3n, year: 4n, custom: 5n };

export const ROLLOVERS = ['none', 'carry_positive', 'carry_all'] as const;
export type Rollover = (typeof ROLLOVERS)[number];
const ROLLOVER_CODE: Readonly<Record<Rollover, bigint>> = { none: 0n, carry_positive: 1n, carry_all: 2n };

export const budgetDirectionOfCode = (code: unknown): BudgetDirection | undefined => BUDGET_DIRECTIONS.find((d) => DIRECTION_CODE[d] === code);
export const periodUnitOfCode = (code: unknown): PeriodUnit | undefined => PERIOD_UNITS.find((u) => UNIT_CODE[u] === code);
export const rolloverOfCode = (code: unknown): Rollover | undefined => ROLLOVERS.find((r) => ROLLOVER_CODE[r] === code);

/** Which transactions a budget watches. An empty set means "no restriction" on that axis (FR-055). */
export interface BudgetScope {
  readonly accountIds: readonly Id[];
  readonly groupIds: readonly Id[];
  readonly categoryIds: readonly Id[];
  readonly tagIds: readonly Id[];
  readonly includeTransfers: boolean;
}

export interface BudgetFields {
  readonly name: string;
  readonly direction: BudgetDirection;
  readonly periodUnit: PeriodUnit;
  readonly periodInterval: number;
  readonly anchorLocalDate: LocalDate;
  readonly customEndLocalDate: LocalDate | null;
  readonly limitMinor: bigint;
  readonly currency: CurrencyCode;
  readonly allocationMinor: bigint;
  readonly rollover: Rollover;
  readonly fundedFromAccountId: Id | null;
  readonly sortOrder: number;
}

export interface Budget extends BudgetFields {
  readonly id: Id;
  readonly scope: BudgetScope;
}

export interface NewBudgetInput {
  readonly name: string;
  readonly direction: BudgetDirection;
  readonly periodUnit: PeriodUnit;
  readonly periodInterval?: number;
  readonly anchorLocalDate: LocalDate;
  readonly customEndLocalDate?: LocalDate | null;
  readonly limitMinor: bigint;
  readonly currency: string;
  /** Defaults to the limit (data-model: Budget). */
  readonly allocationMinor?: bigint;
  readonly rollover?: Rollover;
  readonly fundedFromAccountId?: Id | null;
  readonly sortOrder?: number;
}

export type BudgetError = DomainError<
  'invalid_budget_name' | 'invalid_direction' | 'invalid_period' | 'invalid_interval' | 'invalid_custom_end' | 'invalid_limit' | 'invalid_allocation' |
  'invalid_rollover' | 'unknown_currency'
>;

const inRange = (v: bigint): boolean => v >= 0n && v <= MAX_MINOR;

function validate(input: NewBudgetInput): Result<BudgetFields, BudgetError> {
  const name = cleanName(input.name, MAX_BUDGET_NAME);
  if (name === undefined) return err('invalid_budget_name', `A budget name has 1 to ${MAX_BUDGET_NAME} characters and no line breaks`);
  if (!BUDGET_DIRECTIONS.includes(input.direction)) return err('invalid_direction', 'A budget is for expenses or for income');
  if (!PERIOD_UNITS.includes(input.periodUnit)) return err('invalid_period', 'Unknown budget period');
  const interval = input.periodInterval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return err('invalid_interval', 'A period repeats every 1 or more days, weeks, months or years');
  const currency = parseCurrency(input.currency);
  if (!currency.ok) return currency;
  if (!inRange(input.limitMinor)) return err('invalid_limit', 'The limit is zero or more');
  const allocationMinor = input.allocationMinor ?? input.limitMinor;
  if (!inRange(allocationMinor)) return err('invalid_allocation', 'The allocation is zero or more');
  const rollover = input.rollover ?? 'none';
  if (!ROLLOVERS.includes(rollover)) return err('invalid_rollover', 'Unknown rollover policy');
  let customEnd: LocalDate | null = null;
  if (input.periodUnit === 'custom') {
    customEnd = input.customEndLocalDate ?? null;
    if (customEnd === null || customEnd < input.anchorLocalDate) return err('invalid_custom_end', 'A custom period needs an end date on or after its start');
  }
  return ok({
    name, direction: input.direction, periodUnit: input.periodUnit, periodInterval: interval, anchorLocalDate: input.anchorLocalDate,
    customEndLocalDate: customEnd, limitMinor: input.limitMinor, currency: currency.value, allocationMinor, rollover,
    fundedFromAccountId: input.fundedFromAccountId ?? null, sortOrder: input.sortOrder ?? 0,
  });
}

export const validateNewBudget = (input: NewBudgetInput): Result<BudgetFields, BudgetError> => validate(input);

export type BudgetChanges = Partial<Omit<NewBudgetInput, 'currency'> & { currency: string }>;

/**
 * Applies edits and re-checks every rule. Changing the limit without naming an allocation keeps the two equal when
 * they were equal before, which is what the default means.
 */
export function validateBudgetUpdate(current: BudgetFields, changes: BudgetChanges): Result<BudgetFields, BudgetError> {
  const followsLimit = changes.limitMinor !== undefined && changes.allocationMinor === undefined && current.allocationMinor === current.limitMinor;
  return validate({ ...current, ...changes, ...(followsLimit && { allocationMinor: changes.limitMinor }) });
}

export function budgetFieldPatch(changes: Partial<BudgetFields>): Map<number, FieldValue> {
  const f = new Map<number, FieldValue>();
  if (changes.name !== undefined) f.set(BUDGET_FIELD.name, changes.name);
  if (changes.direction !== undefined) f.set(BUDGET_FIELD.direction, DIRECTION_CODE[changes.direction]);
  if (changes.periodUnit !== undefined) f.set(BUDGET_FIELD.periodUnit, UNIT_CODE[changes.periodUnit]);
  if (changes.periodInterval !== undefined) f.set(BUDGET_FIELD.periodInterval, BigInt(changes.periodInterval));
  if (changes.anchorLocalDate !== undefined) f.set(BUDGET_FIELD.anchorLocalDate, BigInt(changes.anchorLocalDate));
  if (changes.customEndLocalDate !== undefined) f.set(BUDGET_FIELD.customEndLocalDate, changes.customEndLocalDate === null ? null : BigInt(changes.customEndLocalDate));
  if (changes.limitMinor !== undefined) f.set(BUDGET_FIELD.limitMinor, changes.limitMinor);
  if (changes.currency !== undefined) f.set(BUDGET_FIELD.currency, changes.currency);
  if (changes.allocationMinor !== undefined) f.set(BUDGET_FIELD.allocationMinor, changes.allocationMinor);
  if (changes.rollover !== undefined) f.set(BUDGET_FIELD.rollover, ROLLOVER_CODE[changes.rollover]);
  if (changes.fundedFromAccountId !== undefined) f.set(BUDGET_FIELD.fundedFromAccountId, changes.fundedFromAccountId);
  if (changes.sortOrder !== undefined) f.set(BUDGET_FIELD.sortOrder, BigInt(changes.sortOrder));
  return f;
}

/** Decodes a merged record. Shape errors give undefined; rule violations that a merge can create are read as stored. */
export function decodeBudget(rec: Id, state: RecordState): Budget | undefined {
  if (state.table !== TABLE.budget) return undefined;
  const f = new Fields(state);
  const name = f.text(BUDGET_FIELD.name);
  const direction = budgetDirectionOfCode(f.raw(BUDGET_FIELD.direction));
  const periodUnit = periodUnitOfCode(f.raw(BUDGET_FIELD.periodUnit));
  const anchor = f.int(BUDGET_FIELD.anchorLocalDate, 0);
  const limitMinor = f.big(BUDGET_FIELD.limitMinor);
  const currencyText = f.text(BUDGET_FIELD.currency);
  const currency = currencyText === undefined ? undefined : parseCurrency(currencyText);
  const rollover = rolloverOfCode(f.raw(BUDGET_FIELD.rollover) ?? 0n);
  const customEnd = f.nullableBig(BUDGET_FIELD.customEndLocalDate);
  const funded = f.id(BUDGET_FIELD.fundedFromAccountId);
  if (
    name === undefined || direction === undefined || periodUnit === undefined || anchor === 0 || limitMinor === undefined || currency === undefined ||
    !currency.ok || rollover === undefined || customEnd === undefined || funded === undefined
  ) return undefined;
  const interval = f.int(BUDGET_FIELD.periodInterval, 1);
  const allocation = f.has(BUDGET_FIELD.allocationMinor) ? f.big(BUDGET_FIELD.allocationMinor) : limitMinor;
  if (allocation === undefined) return undefined;
  return {
    id: rec, name, direction, periodUnit, periodInterval: interval >= 1 ? interval : 1, anchorLocalDate: anchor as LocalDate,
    customEndLocalDate: customEnd === null ? null : (Number(customEnd) as LocalDate), limitMinor, currency: currency.value, allocationMinor: allocation,
    rollover, fundedFromAccountId: funded, sortOrder: f.int(BUDGET_FIELD.sortOrder, 0),
    scope: {
      accountIds: [...visibleMembers(state, BUDGET_FIELD.accountIds)].sort(), groupIds: [...visibleMembers(state, BUDGET_FIELD.groupIds)].sort(),
      categoryIds: [...visibleMembers(state, BUDGET_FIELD.categoryIds)].sort(), tagIds: [...visibleMembers(state, BUDGET_FIELD.tagIds)].sort(),
      includeTransfers: f.bool(BUDGET_FIELD.includeTransfers, false),
    },
  };
}

// ---------------------------------------------------------------- periods

export interface PeriodSpan {
  readonly index: number;
  readonly from: LocalDate;
  /** Inclusive. */
  readonly to: LocalDate;
}

/** Start of period `k`, counted from the anchor so month-end anchors do not drift (31 Jan, 28 Feb, 31 Mar). */
function periodStart(b: Pick<Budget, 'periodUnit' | 'periodInterval' | 'anchorLocalDate'>, k: number): LocalDate {
  const steps = k * b.periodInterval;
  switch (b.periodUnit) {
    case 'day': return addDays(b.anchorLocalDate, steps);
    case 'week': return addDays(b.anchorLocalDate, steps * 7);
    case 'month': return addMonths(b.anchorLocalDate, steps);
    case 'year': return addMonths(b.anchorLocalDate, steps * 12);
    case 'custom': return b.anchorLocalDate;
  }
}

export function periodSpan(b: Pick<Budget, 'periodUnit' | 'periodInterval' | 'anchorLocalDate' | 'customEndLocalDate'>, index: number): PeriodSpan {
  if (b.periodUnit === 'custom') return { index: 0, from: b.anchorLocalDate, to: b.customEndLocalDate ?? b.anchorLocalDate };
  return { index, from: periodStart(b, index), to: addDays(periodStart(b, index + 1), -1) };
}

/** The period that contains `on`, or undefined before the anchor or after a custom period ends. */
export function periodContaining(b: Pick<Budget, 'periodUnit' | 'periodInterval' | 'anchorLocalDate' | 'customEndLocalDate'>, on: LocalDate): PeriodSpan | undefined {
  if (on < b.anchorLocalDate) return undefined;
  if (b.periodUnit === 'custom') return on <= (b.customEndLocalDate ?? b.anchorLocalDate) ? periodSpan(b, 0) : undefined;
  // A first guess from the distance in days, corrected by at most a step or two (months and years vary in length).
  const days = daysBetween(b.anchorLocalDate, on);
  const perPeriodDays = b.periodUnit === 'day' ? 1 : b.periodUnit === 'week' ? 7 : b.periodUnit === 'month' ? 31 : 366;
  let k = maxOf([0], Number(BigInt(days) / BigInt(perPeriodDays * b.periodInterval)) - 1);
  for (;;) {
    const span = periodSpan(b, k);
    if (on < span.from) k -= 1;
    else if (on > span.to) k += 1;
    else return span;
  }
}

export const periodLengthDays = (span: PeriodSpan): number => daysBetween(span.from, span.to) + 1;
