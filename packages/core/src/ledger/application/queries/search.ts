import type { CurrencyCode } from '../../../shared-kernel/currency';
import type { Id } from '../../../shared-kernel/id';
import type { LocalDate } from '../../../shared-kernel/local-date';
import { labelKey } from '../../domain/label';
import type { Transaction } from '../../domain/records';
import type { TxnStatus } from '../../domain/transaction';
import { compareText, signOf } from '../../domain/util';
import type { Ledger } from '../projections/ledger';

// Filter, search and sort over the local ledger. Nothing here leaves the device (FR-036).

export interface AmountRange {
  /** The currency the bounds are in. Transactions in another currency do not match. */
  readonly currency: string;
  /** Bounds on the size of the amount in minor units, inclusive. */
  readonly min?: bigint;
  readonly max?: bigint;
}

export interface SearchFilter {
  readonly accountIds?: readonly Id[];
  readonly categoryIds?: readonly Id[];
  /** A root category includes its children unless this is false. Default true. */
  readonly includeChildCategories?: boolean;
  readonly uncategorised?: boolean;
  readonly payeeIds?: readonly Id[];
  readonly tagIds?: readonly Id[];
  readonly tagMode?: 'any' | 'all';
  readonly amount?: AmountRange;
  readonly from?: LocalDate;
  readonly to?: LocalDate;
  readonly statuses?: readonly TxnStatus[];
  readonly text?: string;
}

export type SearchSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
export interface Page {
  readonly limit: number;
  readonly offset: number;
}

const size = (v: bigint): bigint => (v < 0n ? -v : v);

function categoryScope(ledger: Ledger, filter: SearchFilter): ReadonlySet<Id> | undefined {
  if (filter.categoryIds === undefined) return undefined;
  const scope = new Set<Id>(filter.categoryIds);
  if (filter.includeChildCategories !== false) {
    for (const c of ledger.categories.values()) if (c.parentId !== null && scope.has(c.parentId)) scope.add(c.id);
  }
  return scope;
}

/** The searchable text of a transaction: its own text and the names of everything it points at. */
function haystack(ledger: Ledger, t: Transaction): string {
  const parts = [t.note, t.place?.name, ledger.accounts.get(t.accountId)?.name];
  if (t.payeeId !== null) parts.push(ledger.payees.get(t.payeeId)?.name);
  if (t.categoryId !== null) {
    const c = ledger.categories.get(t.categoryId);
    parts.push(c?.name);
    if (c?.parentId != null) parts.push(ledger.categories.get(c.parentId)?.name);
  }
  for (const tag of t.tagIds) parts.push(ledger.tags.get(tag)?.name);
  return labelKey(parts.filter((p): p is string => p !== undefined && p !== '').join('\n'));
}

function compare(sort: SearchSort): (a: Transaction, b: Transaction) => number {
  const tie = (a: Transaction, b: Transaction): number => compareText(a.id, b.id);
  const chrono = (a: Transaction, b: Transaction): number => a.localDate - b.localDate || a.occurredUtcMs - b.occurredUtcMs;
  const magnitude = (a: Transaction, b: Transaction): bigint => size(a.baseAmountMinor) - size(b.baseAmountMinor);
  switch (sort) {
    case 'date_asc': return (a, b) => chrono(a, b) || tie(a, b);
    case 'date_desc': return (a, b) => chrono(b, a) || tie(b, a);
    case 'amount_asc': return (a, b) => signOf(magnitude(a, b)) || chrono(a, b) || tie(a, b);
    case 'amount_desc': return (a, b) => signOf(magnitude(b, a)) || chrono(b, a) || tie(b, a);
  }
}

export function searchTransactions(ledger: Ledger, filter: SearchFilter = {}, sort: SearchSort = 'date_desc', page?: Page): Transaction[] {
  const accounts = filter.accountIds === undefined ? undefined : new Set(filter.accountIds);
  const categories = categoryScope(ledger, filter);
  const payees = filter.payeeIds === undefined ? undefined : new Set(filter.payeeIds);
  const statuses = filter.statuses === undefined ? undefined : new Set(filter.statuses);
  const words = filter.text === undefined ? [] : labelKey(filter.text).split(/\s+/u).filter((w) => w !== '');

  const matches = (t: Transaction): boolean => {
    if (accounts !== undefined && !accounts.has(t.accountId)) return false;
    if (categories !== undefined || filter.uncategorised === true) {
      const inScope = t.categoryId !== null && categories?.has(t.categoryId) === true;
      const none = filter.uncategorised === true && t.categoryId === null;
      if (!inScope && !none) return false;
    }
    if (payees !== undefined && (t.payeeId === null || !payees.has(t.payeeId))) return false;
    if (filter.tagIds !== undefined && filter.tagIds.length > 0) {
      const has = (tag: Id): boolean => t.tagIds.includes(tag);
      if (!(filter.tagMode === 'all' ? filter.tagIds.every(has) : filter.tagIds.some(has))) return false;
    }
    if (filter.amount !== undefined) {
      if (t.currency !== (filter.amount.currency as CurrencyCode)) return false;
      const s = size(t.amountMinor);
      if ((filter.amount.min !== undefined && s < filter.amount.min) || (filter.amount.max !== undefined && s > filter.amount.max)) return false;
    }
    if ((filter.from !== undefined && t.localDate < filter.from) || (filter.to !== undefined && t.localDate > filter.to)) return false;
    if (statuses !== undefined && !statuses.has(t.status)) return false;
    if (words.length > 0) {
      const text = haystack(ledger, t);
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  };

  const found = [...ledger.transactions.values()].filter(matches).sort(compare(sort));
  return page === undefined ? found : found.slice(page.offset, page.offset + page.limit);
}
