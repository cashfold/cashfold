import { parseCurrency, type CurrencyCode } from '../../../shared-kernel/currency';
import type { Id } from '../../../shared-kernel/id';
import type { LocalDate } from '../../../shared-kernel/local-date';
import { decodeCheckpoint, type Checkpoint, type HistoryWindow } from '../../../sharing/domain/checkpoint';
import { FOLD_SETTINGS_FIELDS, SETTINGS_TABLE } from '../../../sharing/domain/fold';
import { isVisible, type FoldState } from '../../../sync/domain/merge';
import type { RepairReport } from '../../../sync/application/repair';
import type { Account } from '../../domain/account';
import { categoryTreeViolations } from '../../domain/category';
import { resolveRates, type ExchangeRate } from '../../domain/exchange-rate';
import type { Label } from '../../domain/label';
import {
  decodeAccount, decodeCategory, decodeExchangeRate, decodeGroup, decodeLabel, decodeTransaction, decodeTransfer, deletedAtMs, lastChanged,
  type AccountGroup, type Category, type Transaction,
} from '../../domain/records';
import { TABLE } from '../../domain/tables';
import type { TxnStatus } from '../../domain/transaction';
import type { Transfer } from '../../domain/transfer';
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

export interface DeletedTransfer {
  readonly transfer: Transfer;
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
  /** Visible, not hidden by repair. */
  readonly transfers: ReadonlyMap<Id, Transfer>;
  readonly deletedTransfers: ReadonlyMap<Id, DeletedTransfer>;
  /** When and on which device each transaction was last changed (FR-053), from the clocks of its fields. */
  readonly lastChanged: ReadonlyMap<Id, { readonly dev: Id; readonly atMs: number }>;
  readonly rates: readonly ExchangeRate[];
  /** Entries that count towards balances: orphaned and repair-excluded records are left out. */
  readonly entries: readonly LedgerEntry[];
  readonly entriesByAccount: ReadonlyMap<Id, readonly LedgerEntry[]>;
  /**
   * The checkpoints written for the viewing account, by subject, when it joined with `from_join` history (FR-102). Empty for
   * members who see everything. Account balances already start from them; budgets read them.
   */
  readonly checkpoints: ReadonlyMap<Id, Checkpoint>;
}

const byDateThenRef = (a: LedgerEntry, b: LedgerEntry): number => a.localDate - b.localDate || compareText(a.refId, b.refId) || compareText(a.leg, b.leg);

/**
 * Projects merged record state into typed ledger read models. A pure function of the records and the repair
 * report, so every replica with the same ops sees the same ledger (invariants 1 and 4).
 */
export function buildLedger(records: FoldState, report?: Pick<RepairReport, 'hidden' | 'excluded'>, history?: HistoryWindow): Ledger {
  const accounts = new Map<Id, Account>();
  const groups = new Map<Id, AccountGroup>();
  const categories = new Map<Id, Category>();
  const payees = new Map<Id, Label>();
  const tags = new Map<Id, Label>();
  const transactions = new Map<Id, Transaction>();
  const deleted = new Map<Id, DeletedTransaction>();
  const changed = new Map<Id, { dev: Id; atMs: number }>();
  const transfers = new Map<Id, Transfer>();
  const deletedTransfers = new Map<Id, DeletedTransfer>();
  const allRates: ExchangeRate[] = [];
  const checkpoints = new Map<Id, Checkpoint>();
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
        const last = lastChanged(state);
        if (last !== undefined) changed.set(rec, last);
        if (isVisible(state)) transactions.set(rec, t);
        else deleted.set(rec, { transaction: t, deletedAtMs: deletedAtMs(state) ?? 0 });
        break;
      }
      case TABLE.transfer: {
        const x = decodeTransfer(rec, state);
        if (x === undefined) break;
        const last = lastChanged(state);
        if (last !== undefined) changed.set(rec, last);
        if (isVisible(state)) transfers.set(rec, x);
        else deletedTransfers.set(rec, { transfer: x, deletedAtMs: deletedAtMs(state) ?? 0 });
        break;
      }
      case TABLE.exchangeRate: {
        const r = isVisible(state) ? decodeExchangeRate(rec, state) : undefined;
        if (r !== undefined) allRates.push(r);
        break;
      }
      case TABLE.checkpoint: {
        const c = isVisible(state) ? decodeCheckpoint(rec, state) : undefined;
        if (c !== undefined && history !== undefined && c.member === history.member) checkpoints.set(c.subject, c);
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

  // A member who joined "from now on" starts each account from the balance written for them, and sees only what came after.
  const startsAfter = (account: Id): LocalDate | undefined => {
    const c = checkpoints.get(account);
    return c?.kind === 'account_balance' ? c.asOf : undefined;
  };
  for (const [rec, a] of accounts) {
    const c = checkpoints.get(rec);
    if (c?.kind === 'account_balance') accounts.set(rec, { ...a, openingBalanceMinor: c.valueMinor, openingDate: c.asOf });
  }

  const entries: LedgerEntry[] = [];
  for (const t of transactions.values()) {
    if (!accounts.has(t.accountId) || report?.excluded.has(t.id) === true) continue;
    if (t.localDate <= (startsAfter(t.accountId) ?? 0)) continue;
    entries.push({ accountId: t.accountId, refId: t.id, leg: 'single', localDate: t.localDate, amountMinor: t.amountMinor, status: t.status });
  }
  // A transfer is one record that is two ledger entries: money leaves one account and arrives in the other (FR-043).
  for (const x of transfers.values()) {
    if (report?.excluded.has(x.id) === true) continue;
    if (accounts.has(x.fromAccountId) && x.localDate > (startsAfter(x.fromAccountId) ?? 0)) entries.push({ accountId: x.fromAccountId, refId: x.id, leg: 'out', localDate: x.localDate, amountMinor: -x.fromAmountMinor, status: x.status });
    if (accounts.has(x.toAccountId) && x.localDate > (startsAfter(x.toAccountId) ?? 0)) entries.push({ accountId: x.toAccountId, refId: x.id, leg: 'in', localDate: x.localDate, amountMinor: x.toAmountMinor, status: x.status });
  }
  entries.sort(byDateThenRef);

  const entriesByAccount = new Map<Id, LedgerEntry[]>();
  for (const e of entries) {
    const list = entriesByAccount.get(e.accountId);
    if (list === undefined) entriesByAccount.set(e.accountId, [e]);
    else list.push(e);
  }

  return {
    baseCurrency, accounts, groups, categories, payees, tags, transactions, deleted, transfers, deletedTransfers, lastChanged: changed,
    rates: resolveRates(allRates).rates, entries, entriesByAccount, checkpoints,
  };
}
