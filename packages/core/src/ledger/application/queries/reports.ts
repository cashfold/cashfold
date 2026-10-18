import type { CurrencyCode } from '../../../shared-kernel/currency';
import { convert } from '../../../shared-kernel/fx';
import type { Id } from '../../../shared-kernel/id';
import { addDays, addMonths, compare, dayOf, daysBetween, daysInMonth, monthOf, yearOf, type LocalDate } from '../../../shared-kernel/local-date';
import { MAX_MINOR, MIN_MINOR, money } from '../../../shared-kernel/money';
import { PIVOT_RATE } from '../../../shared-kernel/rate';
import { err, ok, type DomainError, type Result } from '../../../shared-kernel/result';
import { nearestPrior, PIVOT_CURRENCY } from '../../domain/exchange-rate';
import { compareText, signOf } from '../../domain/util';
import type { Transaction } from '../../domain/records';
import { accountBalance } from '../balance';
import type { Ledger } from '../projections/ledger';

// Reports are pure functions of the ledger. Every amount is exact, and every total is built from the same
// per-transaction amounts, so numbers agree across screens (FR-070).

export interface Period {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

/** `adjustmentsAsIncomeExpense` and `transfersAsIncomeExpense` apply to every report (FR-071). */
export interface ReportOptions {
  readonly adjustmentsAsIncomeExpense: boolean;
  readonly transfersAsIncomeExpense: boolean;
}

const inPeriod = (t: { localDate: LocalDate }, p: Period): boolean => t.localDate >= p.from && t.localDate <= p.to;

/**
 * What a posted transaction adds to income and to spending, in the base currency, from the amount frozen at entry.
 * A refund reduces spending. An adjustment is left out unless the user turned the option on, and then counts as
 * income or spending by its sign.
 */
function effect(t: Transaction, options: ReportOptions): { income: bigint; spend: bigint } {
  const base = t.baseAmountMinor;
  switch (t.direction) {
    case 'expense':
      return { income: 0n, spend: -base };
    case 'income':
      return t.isRefund ? { income: 0n, spend: -base } : { income: base, spend: 0n };
    case 'adjustment':
      if (!options.adjustmentsAsIncomeExpense) return { income: 0n, spend: 0n };
      return base < 0n ? { income: 0n, spend: -base } : { income: base, spend: 0n };
  }
}

function postedIn(ledger: Ledger, period: Period): Transaction[] {
  return [...ledger.transactions.values()].filter((t) => t.status === 'posted' && inPeriod(t, period));
}

// ---------------------------------------------------------------- spending

export interface CategorySpend {
  readonly categoryId: Id | null;
  readonly amountMinor: bigint;
}
export interface TagSpend {
  readonly tagId: Id;
  readonly amountMinor: bigint;
}

const byAmountThenKey = <T extends { amountMinor: bigint }>(key: (row: T) => string) => (a: T, b: T): number =>
  signOf(b.amountMinor - a.amountMinor) || compareText(key(a), key(b));

export function spendingByCategory(
  ledger: Ledger, period: Period, options: ReportOptions, opts: { rollUp?: boolean } = {},
): { currency: CurrencyCode | undefined; rows: CategorySpend[]; totalMinor: bigint } {
  const sums = new Map<Id | null, bigint>();
  let totalMinor = 0n;
  for (const t of postedIn(ledger, period)) {
    const { spend } = effect(t, options);
    if (spend === 0n) continue;
    let key = t.categoryId;
    if (opts.rollUp === true && key !== null) key = ledger.categories.get(key)?.parentId ?? key;
    sums.set(key, (sums.get(key) ?? 0n) + spend);
    totalMinor += spend;
  }
  const rows = [...sums].map(([categoryId, amountMinor]): CategorySpend => ({ categoryId, amountMinor }));
  rows.sort(byAmountThenKey((r) => r.categoryId ?? '￿'));
  return { currency: ledger.baseCurrency, rows, totalMinor };
}

/** A transaction counts in full towards each of its tags, so the tag rows can add up to more than the total. */
export function spendingByTag(
  ledger: Ledger, period: Period, options: ReportOptions,
): { currency: CurrencyCode | undefined; rows: TagSpend[]; totalMinor: bigint } {
  const sums = new Map<Id, bigint>();
  let totalMinor = 0n;
  for (const t of postedIn(ledger, period)) {
    const { spend } = effect(t, options);
    if (spend === 0n) continue;
    totalMinor += spend;
    for (const tag of t.tagIds) sums.set(tag, (sums.get(tag) ?? 0n) + spend);
  }
  const rows = [...sums].map(([tagId, amountMinor]): TagSpend => ({ tagId, amountMinor }));
  rows.sort(byAmountThenKey((r) => r.tagId));
  return { currency: ledger.baseCurrency, rows, totalMinor };
}

// ---------------------------------------------------------------- income and expense

export interface IncomeExpense {
  readonly currency: CurrencyCode | undefined;
  readonly incomeMinor: bigint;
  readonly expenseMinor: bigint;
  readonly netMinor: bigint;
}

function sumEffects(ledger: Ledger, period: Period, options: ReportOptions): { income: bigint; spend: bigint } {
  let income = 0n;
  let spend = 0n;
  for (const t of postedIn(ledger, period)) {
    const e = effect(t, options);
    income += e.income;
    spend += e.spend;
  }
  return { income, spend };
}

export function incomeVsExpense(ledger: Ledger, period: Period, options: ReportOptions): IncomeExpense {
  const { income, spend } = sumEffects(ledger, period, options);
  return { currency: ledger.baseCurrency, incomeMinor: income, expenseMinor: spend, netMinor: income - spend };
}

export interface MonthBucket extends IncomeExpense {
  /** yyyymm */
  readonly month: number;
}

const monthKey = (d: LocalDate): number => yearOf(d) * 100 + monthOf(d);

/** Income and expense for every calendar month that overlaps the period, including quiet ones. */
export function monthlyTrend(ledger: Ledger, period: Period, options: ReportOptions): MonthBucket[] {
  const out: MonthBucket[] = [];
  let first = (period.from - dayOf(period.from) + 1) as LocalDate;
  while (first <= period.to) {
    const last = (first + daysInMonth(yearOf(first), monthOf(first)) - 1) as LocalDate;
    const slice = { from: first > period.from ? first : period.from, to: last < period.to ? last : period.to };
    out.push({ month: monthKey(first), ...incomeVsExpense(ledger, slice, options) });
    first = addMonths(first, 1);
  }
  return out;
}

// ---------------------------------------------------------------- net worth

export interface NetWorthAccount {
  readonly accountId: Id;
  readonly currency: CurrencyCode;
  readonly balanceMinor: bigint;
  /** In the base currency, or null when no rate is known for the account's currency. */
  readonly baseMinor: bigint | null;
}

export interface NetWorth {
  readonly currency: CurrencyCode | undefined;
  /** Null when there is no base currency, or a total does not fit in 64 bits. */
  readonly totalMinor: bigint | null;
  readonly accounts: NetWorthAccount[];
  /** Currencies skipped for want of a rate. They are named, never guessed. */
  readonly missing: CurrencyCode[];
}

const EPOCH_DAY = 19_700_101 as LocalDate;
const endOfDayUtcS = (d: LocalDate): number => (daysBetween(EPOCH_DAY, d) + 1) * 86_400 - 1;

/** Balances of the accounts that count towards net worth on a date, converted with the rates in force that day. */
export function netWorth(ledger: Ledger, asOf: LocalDate): NetWorth {
  const base = ledger.baseCurrency;
  const accounts: NetWorthAccount[] = [];
  const missing = new Set<CurrencyCode>();
  let total = 0n;
  let overflow = false;
  const ordered = [...ledger.accounts.values()].filter((a) => a.includeInNetWorth)
    .sort((a, b) => a.sortOrder - b.sortOrder || compareText(a.name, b.name) || compareText(a.id, b.id));
  const rateAt = endOfDayUtcS(asOf);

  for (const a of ordered) {
    const balance = accountBalance(ledger, a.id, asOf);
    if (!balance.ok) {
      overflow = true;
      continue;
    }
    let baseMinor: bigint | null = null;
    if (base !== undefined) {
      if (a.currency === base) baseMinor = balance.value;
      else {
        const from = a.currency === PIVOT_CURRENCY ? PIVOT_RATE : nearestPrior(ledger.rates, a.currency, rateAt)?.rateE12;
        const to = base === PIVOT_CURRENCY ? PIVOT_RATE : nearestPrior(ledger.rates, base, rateAt)?.rateE12;
        const amount = money(balance.value, a.currency);
        if (from === undefined || to === undefined || !amount.ok) missing.add(from === undefined ? a.currency : base);
        else {
          const converted = convert(amount.value, base, from, to);
          if (converted.ok) baseMinor = converted.value.minor;
          else overflow = true;
        }
      }
    }
    accounts.push({ accountId: a.id, currency: a.currency, balanceMinor: balance.value, baseMinor });
    if (baseMinor !== null) total += baseMinor;
  }
  const fits = total >= MIN_MINOR && total <= MAX_MINOR;
  return { currency: base, totalMinor: base === undefined || overflow || !fits ? null : total, accounts, missing: [...missing].sort() };
}

// ---------------------------------------------------------------- day-end balances

export interface DayBalance {
  readonly date: LocalDate;
  readonly balanceMinor: bigint;
}

const MAX_RANGE_DAYS = 3660;
export type DayEndError = DomainError<'unknown_account' | 'invalid_range' | 'out_of_range'>;

/** The balance at the end of every day in a range, in the account's own currency. Pending and void entries never count. */
export function dayEndBalances(ledger: Ledger, accountId: Id, range: Period): Result<DayBalance[], DayEndError> {
  const account = ledger.accounts.get(accountId);
  if (account === undefined) return err('unknown_account', 'That account does not exist');
  const days = daysBetween(range.from, range.to);
  if (days < 0 || days >= MAX_RANGE_DAYS) return err('invalid_range', 'Pick a range of at most ten years');

  const start = accountBalance(ledger, accountId, addDays(range.from, -1));
  if (!start.ok) return start.error.code === 'unknown_account' ? err('unknown_account', start.error.message) : err('out_of_range', start.error.message);
  const perDay = new Map<LocalDate, bigint>();
  for (const e of ledger.entriesByAccount.get(accountId) ?? []) {
    if (e.status === 'posted' && compare(e.localDate, range.from) >= 0 && compare(e.localDate, range.to) <= 0) {
      perDay.set(e.localDate, (perDay.get(e.localDate) ?? 0n) + e.amountMinor);
    }
  }
  const out: DayBalance[] = [];
  let running = start.value;
  for (let i = 0; i <= days; i++) {
    const date = addDays(range.from, i);
    running += perDay.get(date) ?? 0n;
    if (running > MAX_MINOR || running < MIN_MINOR) return err('out_of_range', 'A balance is outside the supported range');
    out.push({ date, balanceMinor: running });
  }
  return ok(out);
}

// ---------------------------------------------------------------- periods

export type PeriodSpec =
  | { readonly kind: 'this_month' }
  | { readonly kind: 'last_month' }
  | { readonly kind: 'this_year' }
  | { readonly kind: 'last_days'; readonly days: number }
  | { readonly kind: 'all_time' }
  | { readonly kind: 'custom'; readonly from: LocalDate; readonly to: LocalDate };

const FIRST_DAY = 10_101 as LocalDate;
const LAST_DAY = 99_991_231 as LocalDate;

export function resolvePeriod(spec: PeriodSpec, today: LocalDate): Period {
  const y = yearOf(today);
  const m = monthOf(today);
  switch (spec.kind) {
    case 'this_month':
      return { from: (y * 10_000 + m * 100 + 1) as LocalDate, to: (y * 10_000 + m * 100 + daysInMonth(y, m)) as LocalDate };
    case 'last_month': {
      const first = addMonths((y * 10_000 + m * 100 + 1) as LocalDate, -1);
      return { from: first, to: (first + daysInMonth(yearOf(first), monthOf(first)) - 1) as LocalDate };
    }
    case 'this_year':
      return { from: (y * 10_000 + 101) as LocalDate, to: (y * 10_000 + 1231) as LocalDate };
    case 'last_days':
      return { from: addDays(today, -(spec.days - 1)), to: today };
    case 'all_time':
      return { from: FIRST_DAY, to: LAST_DAY };
    case 'custom':
      return spec.from <= spec.to ? { from: spec.from, to: spec.to } : { from: spec.to, to: spec.from };
  }
}
