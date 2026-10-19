import type { CurrencyCode } from '../../shared-kernel/currency';
import { convert } from '../../shared-kernel/fx';
import type { Id } from '../../shared-kernel/id';
import type { LocalDate } from '../../shared-kernel/local-date';
import { PIVOT_RATE } from '../../shared-kernel/rate';
import { isVisible, type FoldState } from '../../sync/domain/merge';
import { nearestPrior, PIVOT_CURRENCY } from '../../ledger/domain/exchange-rate';
import type { Transaction } from '../../ledger/domain/records';
import { TABLE } from '../../ledger/domain/tables';
import { endOfDayUtcS } from '../../ledger/application/queries/reports';
import type { Ledger } from '../../ledger/application/projections/ledger';
import { maxOf } from '../../ledger/domain/util';
import { decodeBudget, periodContaining, periodLengthDays, periodSpan, type Budget } from '../domain/budget';

// A budget period is derived, never stored (data-model: BudgetPeriod). Everything here is a pure function of the
// ledger and the budget, so replicas holding the same ops compute the same numbers, however the ops arrived.

export interface BudgetPeriodView {
  readonly budgetId: Id;
  readonly index: number;
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly dayCount: number;
  readonly currency: CurrencyCode;
  readonly limitMinor: bigint;
  readonly allocationMinor: bigint;
  readonly carryInMinor: bigint;
  readonly spentMinor: bigint;
  /** `carry_in + allocation − spent`. */
  readonly availableMinor: bigint;
  /** Currencies that could not be converted for lack of a rate; their entries are left out of `spentMinor`. */
  readonly missingRates: readonly CurrencyCode[];
}

/** All visible budgets of a Fold, in the order the user arranged them. */
export function buildBudgets(records: FoldState): ReadonlyMap<Id, Budget> {
  const list: Budget[] = [];
  for (const [rec, state] of records) {
    if (state.table !== TABLE.budget || !isVisible(state)) continue;
    const b = decodeBudget(rec, state);
    if (b !== undefined) list.push(b);
  }
  list.sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(list.map((b) => [b.id, b]));
}

interface Matcher {
  account(id: Id): boolean;
  transaction(t: Transaction): boolean;
  /** Transfers have no category or tags, so a budget limited to either never sees them. */
  readonly transfersAllowed: boolean;
}

function matcherFor(ledger: Ledger, budget: Budget): Matcher {
  const { accountIds, groupIds, categoryIds, tagIds, includeTransfers } = budget.scope;
  const accounts = new Set(accountIds);
  const groups = new Set(groupIds);
  const allAccounts = accounts.size === 0 && groups.size === 0;
  // Choosing a top-level category covers its subcategories.
  const categories = new Set(categoryIds);
  for (const c of ledger.categories.values()) if (c.parentId !== null && categories.has(c.parentId)) categories.add(c.id);
  const tags = new Set(tagIds);
  const accountOk = (id: Id): boolean => {
    if (allAccounts || accounts.has(id)) return true;
    return ledger.accounts.get(id)?.groupIds.some((g) => groups.has(g)) === true;
  };
  return {
    account: accountOk,
    transfersAllowed: includeTransfers && categories.size === 0 && tags.size === 0,
    transaction: (t) =>
      ledger.accounts.has(t.accountId) && accountOk(t.accountId) && (categories.size === 0 || (t.categoryId !== null && categories.has(t.categoryId))) &&
      (tags.size === 0 || t.tagIds.some((tag) => tags.has(tag))),
  };
}

/** What a posted transaction adds to "spent" for this budget direction, in its own units, before conversion. */
function contribution(budget: Budget, t: Transaction): { own: bigint; base: bigint } | undefined {
  if (budget.direction === 'expense') {
    if (t.direction === 'expense' || (t.direction === 'income' && t.isRefund)) return { own: -t.amountMinor, base: -t.baseAmountMinor };
    return undefined;
  }
  return t.direction === 'income' && !t.isRefund ? { own: t.amountMinor, base: t.baseAmountMinor } : undefined;
}

export class Converter {
  readonly missing = new Set<CurrencyCode>();
  constructor(private readonly ledger: Ledger, private readonly target: CurrencyCode) {}

  /** Converts exactly with the rates in force on `date`, or records the missing currency. */
  amount(minor: bigint, from: CurrencyCode, date: LocalDate): bigint | undefined {
    if (from === this.target) return minor;
    const at = endOfDayUtcS(date);
    const rateFrom = from === PIVOT_CURRENCY ? PIVOT_RATE : nearestPrior(this.ledger.rates, from, at)?.rateE12;
    const rateTo = this.target === PIVOT_CURRENCY ? PIVOT_RATE : nearestPrior(this.ledger.rates, this.target, at)?.rateE12;
    if (rateFrom === undefined || rateTo === undefined) {
      this.missing.add(rateFrom === undefined ? from : this.target);
      return undefined;
    }
    const converted = convert({ minor, currency: from }, this.target, rateFrom, rateTo);
    return converted.ok ? converted.value.minor : undefined;
  }
}

/** Spending of each period from the anchor up to `lastIndex`, in one pass over the ledger. */
function spentByPeriod(ledger: Ledger, budget: Budget, lastIndex: number): { spent: Map<number, bigint>; missing: ReadonlySet<CurrencyCode> } {
  const matcher = matcherFor(ledger, budget);
  const converter = new Converter(ledger, budget.currency);
  const spent = new Map<number, bigint>();
  const add = (date: LocalDate, minor: bigint): void => {
    const span = periodContaining(budget, date);
    if (span === undefined || span.index > lastIndex) return;
    spent.set(span.index, (spent.get(span.index) ?? 0n) + minor);
  };
  for (const t of ledger.transactions.values()) {
    if (t.status !== 'posted' || !matcher.transaction(t)) continue;
    const part = contribution(budget, t);
    if (part === undefined) continue;
    // The amount frozen at entry is used when it is already in the budget currency; otherwise convert the account amount.
    const minor = t.currency === budget.currency ? part.own : t.baseCurrency === budget.currency ? part.base : converter.amount(part.own, t.currency, t.localDate);
    if (minor !== undefined) add(t.localDate, minor);
  }
  if (matcher.transfersAllowed) {
    for (const x of ledger.transfers.values()) {
      if (x.status !== 'posted') continue;
      const accountId = budget.direction === 'expense' ? x.fromAccountId : x.toAccountId;
      const own = budget.direction === 'expense' ? x.fromAmountMinor : x.toAmountMinor;
      const account = ledger.accounts.get(accountId);
      if (account === undefined || !matcher.account(accountId)) continue;
      const minor = converter.amount(own, account.currency, x.localDate);
      if (minor !== undefined) add(x.localDate, minor);
    }
  }
  return { spent, missing: converter.missing };
}

/** The budget's period number `index` (0 is the one starting at the anchor). */
export function budgetPeriodAt(ledger: Ledger, budget: Budget, index: number): BudgetPeriodView {
  const last = budget.periodUnit === 'custom' ? 0 : maxOf([0], index);
  const { spent, missing } = spentByPeriod(ledger, budget, last);
  let carryIn = 0n;
  let view: BudgetPeriodView | undefined;
  for (let k = 0; k <= last; k++) {
    const span = periodSpan(budget, k);
    const spentMinor = spent.get(k) ?? 0n;
    const availableMinor = carryIn + budget.allocationMinor - spentMinor;
    view = {
      budgetId: budget.id, index: k, from: span.from, to: span.to, dayCount: periodLengthDays(span), currency: budget.currency,
      limitMinor: budget.limitMinor, allocationMinor: budget.allocationMinor, carryInMinor: carryIn, spentMinor, availableMinor,
      missingRates: [...missing].sort(),
    };
    // Rollover is a policy of the budget, so changing it recomputes every period from the same transactions.
    carryIn = budget.rollover === 'none' ? 0n : budget.rollover === 'carry_positive' ? (availableMinor > 0n ? availableMinor : 0n) : availableMinor;
  }
  return view!;
}

/** The period containing `on`, or undefined before the budget starts or after a custom period ends. */
export function budgetPeriodOn(ledger: Ledger, budget: Budget, on: LocalDate): BudgetPeriodView | undefined {
  const span = periodContaining(budget, on);
  return span === undefined ? undefined : budgetPeriodAt(ledger, budget, span.index);
}
