import { parseCurrency, type CurrencyCode } from '../../../shared-kernel/currency';
import type { Id } from '../../../shared-kernel/id';
import type { LocalDate } from '../../../shared-kernel/local-date';
import { FOLD_SETTINGS_FIELDS, SETTINGS_TABLE } from '../../../sharing/domain/fold';
import { isVisible, type FoldState } from '../../../sync/domain/merge';
import type { RepairReport } from '../../../sync/application/repair';
import type { Account } from '../../domain/account';
import { categoryTreeViolations } from '../../domain/category';
import { resolveRates, type ExchangeRate } from '../../domain/exchange-rate';
import type { Label } from '../../domain/label';
import {
  decodeAccount, decodeCategory, decodeExchangeRate, decodeGroup, decodeLabel, decodeTransaction, deletedAtMs,
  type AccountGroup, type Category, type Transaction,
} from '../../domain/records';
import { TABLE } from '../../domain/tables';
import type { TxnStatus } from '../../domain/transaction';
import { compareText } from '../../domain/util';

/** One signed movement on one account: the derived `ledger_entry` read model (data-model.md). */
export interface LedgerEntry {
  readonly accountId: Id;
  readonly refId: Id;
  readonly leg: 'single' | 'out' | 'in';
  readonly localDate: LocalDate;
  readonly amountMinor: bigint;
  readonly status: TxnStatus;
}

export interface DeletedTransaction {
  readonly transaction: Transaction;
  readonly deletedAtMs: number;
}

export interface Ledger {
  readonly baseCurrency: CurrencyCode | undefined;
  readonly accounts: ReadonlyMap<Id, Account>;
  readonly groups: ReadonlyMap<Id, AccountGroup>;
  readonly categories: ReadonlyMap<Id, Category>;
  readonly payees: ReadonlyMap<Id, Label>;
  readonly tags: ReadonlyMap<Id, Label>;
  /** Visible, not hidden by repair. */
  readonly transactions: ReadonlyMap<Id, Transaction>;
  readonly deleted: ReadonlyMap<Id, DeletedTransaction>;
  readonly rates: readonly ExchangeRate[];
  /** Entries that count towards balances: orphaned and repair-excluded records are left out. */
  readonly entries: readonly LedgerEntry[];
  readonly entriesByAccount: ReadonlyMap<Id, readonly LedgerEntry[]>;
}

const byDateThenRef = (a: LedgerEntry, b: LedgerEntry): number => a.localDate - b.localDate || compareText(a.refId, b.refId);

/**
 * Projects merged record state into typed ledger read models. A pure function of the records and the repair
 * report, so every replica with the same ops sees the same ledger (invariants 1 and 4).
 */
export function buildLedger(records: FoldState, report?: Pick<RepairReport, 'hidden' | 'excluded'>): Ledger {
  const accounts = new Map<Id, Account>();
  const groups = new Map<Id, AccountGroup>();
  const categories = new Map<Id, Category>();
  const payees = new Map<Id, Label>();
  const tags = new Map<Id, Label>();
  const transactions = new Map<Id, Transaction>();
  const deleted = new Map<Id, DeletedTransaction>();
  const allRates: ExchangeRate[] = [];
  let baseCurrency: CurrencyCode | undefined;

  for (const [rec, state] of records) {
    if (report?.hidden.has(rec) === true) continue;
    switch (state.table) {
      case TABLE.account: {
        const a = isVisible(state) ? decodeAccount(rec, state) : undefined;
        if (a !== undefined) accounts.set(rec, a);
        break;
      }
      case TABLE.accountGroup: {
        const g = isVisible(state) ? decodeGroup(rec, state) : undefined;
        if (g !== undefined) groups.set(rec, g);
        break;
      }
      case TABLE.category: {
        const c = isVisible(state) ? decodeCategory(rec, state) : undefined;
        if (c !== undefined) categories.set(rec, c);
        break;
      }
      case TABLE.payee: {
        const p = isVisible(state) ? decodeLabel(rec, state, TABLE.payee) : undefined;
        if (p !== undefined) payees.set(rec, p);
        break;
      }
      case TABLE.tag: {
        const t = isVisible(state) ? decodeLabel(rec, state, TABLE.tag) : undefined;
        if (t !== undefined) tags.set(rec, t);
        break;
      }
      case TABLE.transaction: {
        const t = decodeTransaction(rec, state);
        if (t === undefined) break;
        if (isVisible(state)) transactions.set(rec, t);
        else deleted.set(rec, { transaction: t, deletedAtMs: deletedAtMs(state) ?? 0 });
        break;
      }
      case TABLE.exchangeRate: {
        const r = isVisible(state) ? decodeExchangeRate(rec, state) : undefined;
        if (r !== undefined) allRates.push(r);
        break;
      }
      case SETTINGS_TABLE: {
        const text = state.fields.get(FOLD_SETTINGS_FIELDS.baseCurrency)?.value;
        const parsed = typeof text === 'string' ? parseCurrency(text) : undefined;
        if (parsed?.ok === true) baseCurrency = parsed.value;
        break;
      }
      default:
        break;
    }
  }

  // A category whose parent link breaks a tree rule is read as a top-level one (ARCH 9.5); repair reports it.
  for (const rec of categoryTreeViolations(categories).keys()) {
    categories.set(rec, { ...categories.get(rec)!, parentId: null });
  }

  // A group that was deleted or never arrived is not a group the account is in.
  for (const [rec, a] of accounts) {
    const live = a.groupIds.filter((g) => groups.has(g));
    if (live.length !== a.groupIds.length) accounts.set(rec, { ...a, groupIds: live });
  }

  const entries: LedgerEntry[] = [];
  for (const t of transactions.values()) {
    if (!accounts.has(t.accountId) || report?.excluded.has(t.id) === true) continue;
    entries.push({ accountId: t.accountId, refId: t.id, leg: 'single', localDate: t.localDate, amountMinor: t.amountMinor, status: t.status });
  }
  entries.sort(byDateThenRef);

  const entriesByAccount = new Map<Id, LedgerEntry[]>();
  for (const e of entries) {
    const list = entriesByAccount.get(e.accountId);
    if (list === undefined) entriesByAccount.set(e.accountId, [e]);
    else list.push(e);
  }

  return {
    baseCurrency, accounts, groups, categories, payees, tags, transactions, deleted,
    rates: resolveRates(allRates).rates, entries, entriesByAccount,
  };
}
