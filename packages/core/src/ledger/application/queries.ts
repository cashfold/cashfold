import type { Id } from '../../shared-kernel/id';
import type { LocalDate } from '../../shared-kernel/local-date';
import type { QueryDef } from '../../sync/application/buses';
import { buildNeedsAttention, type NeedsAttentionItem } from '../../sync/application/repair';
import type { Account } from '../domain/account';
import type { Label } from '../domain/label';
import type { AccountGroup, Category, Transaction } from '../domain/records';
import { compareText } from '../domain/util';
import { accountBalance } from './balance';
import type { ClockPort, QuarantinedOp } from '../../sync/ports/index';
import { recentlyDeleted, type RecentlyDeleted } from './queries/recently-deleted';
import {
  dayEndBalances, incomeVsExpense, monthlyTrend, netWorth, spendingByCategory, spendingByTag,
  type CategorySpend, type DayBalance, type IncomeExpense, type MonthBucket, type NetWorth, type Period, type ReportOptions, type TagSpend,
} from './queries/reports';
import { searchTransactions, type Page, type SearchFilter, type SearchSort } from './queries/search';
import type { LedgerViews } from './views';
import type { DomainError } from '../../shared-kernel/result';

export interface AccountRow extends Account {
  /** Posted balance today, or null if it does not fit in 64 bits. */
  readonly balanceMinor: bigint | null;
}

/** A transaction as listed, with when and on which device it last changed (FR-053). */
export interface TransactionRow extends Transaction {
  readonly lastChanged: { readonly dev: Id; readonly atMs: number } | undefined;
}

export interface LedgerBasics {
  readonly baseCurrency: string | undefined;
  readonly accounts: readonly AccountRow[];
  readonly groups: readonly AccountGroup[];
  readonly categories: readonly Category[];
  readonly payees: readonly Label[];
  readonly tags: readonly Label[];
}

export interface DashboardData {
  readonly netWorth: NetWorth;
  readonly incomeExpense: IncomeExpense;
  readonly spending: { readonly rows: CategorySpend[]; readonly totalMinor: bigint };
  readonly tags: { readonly rows: TagSpend[]; readonly totalMinor: bigint };
  readonly trend: MonthBucket[];
}

const byOrder = (a: { sortOrder: number; name: string; id: Id }, b: { sortOrder: number; name: string; id: Id }): number =>
  a.sortOrder - b.sortOrder || compareText(a.name, b.name) || compareText(a.id, b.id);
const byName = (a: Label, b: Label): number => compareText(a.name, b.name) || compareText(a.id, b.id);

/** Read-only queries over the cached ledger view. Every one needs at least the viewer role. */
export interface LedgerQueryDeps {
  readonly views: LedgerViews;
  readonly clock: ClockPort;
  /** Ops the sync engine set aside, which Needs attention lists next to the repair findings. */
  quarantined(fold: Id): Promise<readonly QuarantinedOp[]>;
}

export function createLedgerQueries({ views, clock, quarantined }: LedgerQueryDeps) {
  const q = <Q extends { fold: Id }, R>(name: string, read: (query: Q, v: Awaited<ReturnType<LedgerViews['get']>>) => R): QueryDef<Q, R> => ({
    name, requires: 'viewer', foldOf: (query) => query.fold, read: async (query, ctx) => read(query, await views.get(query.fold, ctx.reader)),
  });

  const ledgerBasics = q<{ fold: Id }, LedgerBasics>('ledgerBasics', (_, { ledger }) => ({
    baseCurrency: ledger.baseCurrency,
    accounts: [...ledger.accounts.values()].sort(byOrder).map((a): AccountRow => {
      const b = accountBalance(ledger, a.id);
      return { ...a, balanceMinor: b.ok ? b.value : null };
    }),
    groups: [...ledger.groups.values()].sort(byOrder),
    categories: [...ledger.categories.values()].sort((a, b) => a.direction.localeCompare(b.direction) || byOrder(a, b)),
    payees: [...ledger.payees.values()].sort(byName),
    tags: [...ledger.tags.values()].sort(byName),
  }));

  const accountBalanceQuery = q<{ fold: Id; account: Id; asOf?: LocalDate }, bigint | undefined>('accountBalance', ({ account, asOf }, { ledger }) => {
    const r = accountBalance(ledger, account, asOf);
    return r.ok ? r.value : undefined;
  });

  const listTransactions = q<{ fold: Id; filter?: SearchFilter; sort?: SearchSort; page?: Page }, { items: TransactionRow[]; count: number }>(
    'listTransactions',
    ({ filter, sort, page }, { ledger }) => {
      const all = searchTransactions(ledger, filter ?? {}, sort ?? 'date_desc');
      const shown = page === undefined ? all : all.slice(page.offset, page.offset + page.limit);
      return { items: shown.map((t) => ({ ...t, lastChanged: ledger.lastChanged.get(t.id) })), count: all.length };
    },
  );

  const netWorthQuery = q<{ fold: Id; asOf: LocalDate }, NetWorth>('netWorth', ({ asOf }, { ledger }) => netWorth(ledger, asOf));
  const spendingByCategoryQuery = q<{ fold: Id; period: Period; options: ReportOptions; rollUp?: boolean }, ReturnType<typeof spendingByCategory>>(
    'spendingByCategory', ({ period, options, rollUp }, { ledger }) => spendingByCategory(ledger, period, options, { rollUp: rollUp ?? false }),
  );
  const incomeVsExpenseQuery = q<{ fold: Id; period: Period; options: ReportOptions }, IncomeExpense>(
    'incomeVsExpense', ({ period, options }, { ledger }) => incomeVsExpense(ledger, period, options),
  );
  const dayEndBalancesQuery = q<{ fold: Id; account: Id; range: Period }, { ok: true; value: DayBalance[] } | { ok: false; error: DomainError }>(
    'dayEndBalances', ({ account, range }, { ledger }) => dayEndBalances(ledger, account, range),
  );

  /** Everything the dashboard shows, from one consistent snapshot (FR-069, FR-070). */
  const dashboard = q<{ fold: Id; period: Period; asOf: LocalDate; options: ReportOptions }, DashboardData>('dashboard', ({ period, asOf, options }, { ledger }) => ({
    netWorth: netWorth(ledger, asOf),
    incomeExpense: incomeVsExpense(ledger, period, options),
    spending: spendingByCategory(ledger, period, options, { rollUp: true }),
    tags: spendingByTag(ledger, period, options),
    trend: monthlyTrend(ledger, period, options),
  }));

  const recentlyDeletedQuery = q<{ fold: Id }, RecentlyDeleted[]>('recentlyDeleted', (_, { ledger }) => recentlyDeleted(ledger, clock.nowMs()));

  const needsAttention: QueryDef<{ fold: Id }, NeedsAttentionItem[]> = {
    name: 'needsAttention', requires: 'viewer', foldOf: (query) => query.fold,
    async read(query, ctx) {
      const view = await views.get(query.fold, ctx.reader);
      return buildNeedsAttention(view.report, await quarantined(query.fold));
    },
  };

  return {
    ledgerBasics, accountBalance: accountBalanceQuery, listTransactions, netWorth: netWorthQuery, spendingByCategory: spendingByCategoryQuery,
    incomeVsExpense: incomeVsExpenseQuery, dayEndBalances: dayEndBalancesQuery, dashboard, recentlyDeleted: recentlyDeletedQuery, needsAttention,
  };
}
