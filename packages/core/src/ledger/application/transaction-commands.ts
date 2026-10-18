import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import { money } from '../../shared-kernel/money';
import { parseCurrency } from '../../shared-kernel/currency';
import { SETTINGS_TABLE, FOLD_SETTINGS_FIELDS, settingsRecordId } from '../../sharing/domain/fold';
import type { CommandContext, CommandDef } from '../../sync/application/buses';
import { DELETED_FIELD, isVisible, type FieldValue, type SetDelta } from '../../sync/domain/merge';
import type { ClockPort } from '../../sync/ports/index';
import type { Account } from '../domain/account';
import { checkEntryAllowed, type AccountError, type EntryError } from '../domain/account';
import { decodeTransaction, deletedAtMs, type Transaction } from '../domain/records';
import { addMembers, setTo } from '../domain/sets';
import { TABLE, TXN_FIELD } from '../domain/tables';
import {
  canTransition, transactionFieldPatch, validateTransactionEntry,
  type Place, type TransactionError, type TxnDirection, type TxnStatus,
} from '../domain/transaction';
import { secondsOf } from '../domain/util';
import { loadAccount, loadCategory, loadLabel, loadLedger, noSets, type NotFound } from './context';
import { snapshotBase, type SnapshotError } from './fx-snapshot';

/** Deleted records stay restorable for this long (FR-052). */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type TransactionCommandError =
  | TransactionError
  | EntryError
  | AccountError
  | NotFound
  | SnapshotError
  | DomainError<'transaction_exists' | 'category_direction_mismatch' | 'category_not_allowed' | 'refund_must_be_income' | 'invalid_status_change' | 'not_deleted' | 'retention_expired'>;

export interface AddTransactionCommand {
  readonly fold: Id;
  readonly id: Id;
  readonly accountId: Id;
  readonly direction: TxnDirection;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly occurredUtcMs: number;
  readonly tzOffsetMin: number;
  readonly categoryId?: Id | null;
  readonly payeeId?: Id | null;
  readonly tagIds?: readonly Id[];
  readonly note?: string;
  readonly place?: Place | null;
  readonly status?: TxnStatus;
  readonly isRefund?: boolean;
  readonly isPinned?: boolean;
  readonly attachmentRef?: Id | null;
  readonly origin?: { readonly scheduleId: Id; readonly n: number } | null;
  readonly importId?: Id | null;
}

export interface TransactionChanges {
  readonly accountId?: Id;
  readonly direction?: TxnDirection;
  readonly amountMinor?: bigint;
  readonly currency?: string;
  readonly occurredUtcMs?: number;
  readonly tzOffsetMin?: number;
  readonly categoryId?: Id | null;
  readonly payeeId?: Id | null;
  readonly tagIds?: readonly Id[];
  readonly note?: string;
  readonly place?: Place | null;
  readonly status?: TxnStatus;
  readonly isRefund?: boolean;
  readonly isPinned?: boolean;
  readonly attachmentRef?: Id | null;
}

type Reading = Pick<CommandContext, 'reader'>;

/** The Fold's base currency, from its settings record. */
export async function baseCurrencyOf(ctx: Reading, fold: Id) {
  const settings = await ctx.reader.getRecord(fold, settingsRecordId(fold));
  const text = settings?.table === SETTINGS_TABLE ? settings.fields.get(FOLD_SETTINGS_FIELDS.baseCurrency)?.value : undefined;
  return typeof text === 'string' ? parseCurrency(text) : undefined;
}

/** A transaction must point at a category of its own direction, an existing payee and existing tags. */
async function checkReferences(
  ctx: Reading, fold: Id,
  t: { direction: TxnDirection; categoryId: Id | null; payeeId: Id | null; tagIds: readonly Id[]; isRefund: boolean },
): Promise<Result<true, TransactionCommandError>> {
  if (t.isRefund && t.direction !== 'income') return err('refund_must_be_income', 'A refund is an income entry');
  if (t.categoryId !== null) {
    if (t.direction === 'adjustment') return err('category_not_allowed', 'A balance adjustment has no category');
    const category = await loadCategory(ctx, fold, t.categoryId);
    if (!category.ok) return category;
    if (category.value.direction !== t.direction) return err('category_direction_mismatch', 'The category is for the other kind of entry');
  }
  if (t.payeeId !== null) {
    const payee = await loadLabel(ctx, fold, t.payeeId, TABLE.payee);
    if (!payee.ok) return payee;
  }
  for (const tag of t.tagIds) {
    const found = await loadLabel(ctx, fold, tag, TABLE.tag);
    if (!found.ok) return found;
  }
  return ok(true as const);
}

/** The base-currency equivalent for an amount, or the reason there is none. */
export async function snapshotFor(ctx: Reading, fold: Id, account: Account, amountMinor: bigint, occurredUtcMs: number) {
  const base = await baseCurrencyOf(ctx, fold);
  const amount = money(amountMinor, account.currency);
  if (!amount.ok) return amount;
  if (base === undefined || !base.ok || base.value === account.currency) {
    return ok({ baseAmountMinor: amountMinor, baseCurrency: account.currency, fxRateId: null, fxBaseRateId: null });
  }
  const ledger = await loadLedger(ctx, fold);
  return snapshotBase({ amount: amount.value, baseCurrency: base.value, rates: ledger.rates, asOfUtcS: secondsOf(occurredUtcMs) });
}

export function createTransactionCommands({ clock }: { clock: ClockPort }) {
  const addTransaction: CommandDef<AddTransactionCommand, Transaction, TransactionCommandError> = {
    name: 'addTransaction',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      if ((await ctx.reader.getRecord(c.fold, c.id)) !== undefined) return err('transaction_exists', 'A transaction with this id already exists');
      const account = await loadAccount(ctx, c.fold, c.accountId);
      if (!account.ok) return account;
      const entry = validateTransactionEntry(
        { direction: c.direction, amountMinor: c.amountMinor, currency: c.currency, occurredUtcMs: c.occurredUtcMs, tzOffsetMin: c.tzOffsetMin, tagIds: c.tagIds ?? [], note: c.note ?? '', place: c.place ?? null, status: c.status ?? 'posted' },
        account.value,
      );
      if (!entry.ok) return entry;
      const allowed = checkEntryAllowed(account.value, c.direction, entry.value.localDate);
      if (!allowed.ok) return allowed;

      const references = await checkReferences(ctx, c.fold, {
        direction: c.direction, categoryId: c.categoryId ?? null, payeeId: c.payeeId ?? null, tagIds: entry.value.tagIds, isRefund: c.isRefund ?? false,
      });
      if (!references.ok) return references;

      const base = await snapshotFor(ctx, c.fold, account.value, c.amountMinor, c.occurredUtcMs);
      if (!base.ok) return base;

      const fields = transactionFieldPatch({
        ...entry.value, accountId: c.accountId, ...base.value, categoryId: c.categoryId ?? null, payeeId: c.payeeId ?? null,
        attachmentRef: c.attachmentRef ?? null, isRefund: c.isRefund ?? false, isPinned: c.isPinned ?? false,
        origin: c.origin ?? null, importId: c.importId ?? null,
      });
      const sets = entry.value.tagIds.length === 0 ? noSets : new Map<number, SetDelta>([[TXN_FIELD.tagIds, addMembers(entry.value.tagIds)]]);
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.transaction, fields, sets }]);
      if (!written.ok) return written as never;
      const saved = decodeTransaction(c.id, written.value[0]!.after);
      if (saved === undefined) throw new Error('a transaction that was just written must decode');
      return ok(saved);
    },
  };

  const updateTransaction: CommandDef<{ fold: Id; id: Id; changes: TransactionChanges }, Transaction, TransactionCommandError> = {
    name: 'updateTransaction',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      const current = state !== undefined && state.table === TABLE.transaction && isVisible(state) ? decodeTransaction(c.id, state) : undefined;
      if (state === undefined || current === undefined) return err('not_found', 'That transaction does not exist');
      const ch = c.changes;

      const accountId = ch.accountId ?? current.accountId;
      const account = await loadAccount(ctx, c.fold, accountId);
      if (!account.ok) return account;

      const merged = {
        direction: ch.direction ?? current.direction,
        amountMinor: ch.amountMinor ?? current.amountMinor,
        currency: ch.currency ?? account.value.currency,
        occurredUtcMs: ch.occurredUtcMs ?? current.occurredUtcMs,
        tzOffsetMin: ch.tzOffsetMin ?? current.tzOffsetMin,
        tagIds: ch.tagIds ?? current.tagIds,
        note: ch.note ?? current.note,
        place: ch.place === undefined ? current.place : ch.place,
        status: ch.status ?? current.status,
      };
      const entry = validateTransactionEntry(merged, account.value);
      if (!entry.ok) return entry;
      if (ch.status !== undefined && !canTransition(current.status, ch.status)) {
        return err('invalid_status_change', 'That status change is not allowed');
      }
      // Moving an entry to another account is a new entry there: the account must accept it.
      if (ch.accountId !== undefined && ch.accountId !== current.accountId) {
        const allowed = checkEntryAllowed(account.value, entry.value.direction, entry.value.localDate);
        if (!allowed.ok) return allowed;
      }

      const next = {
        categoryId: ch.categoryId === undefined ? current.categoryId : ch.categoryId,
        payeeId: ch.payeeId === undefined ? current.payeeId : ch.payeeId,
        isRefund: ch.isRefund ?? current.isRefund,
      };
      const references = await checkReferences(ctx, c.fold, { direction: entry.value.direction, ...next, tagIds: entry.value.tagIds });
      if (!references.ok) return references;

      const patch = new Map<number, FieldValue>();
      const put = (more: Map<number, FieldValue>): void => {
        for (const [k, v] of more) patch.set(k, v);
      };

      // The amount group moves as one, with a fresh base snapshot, whenever any of it changes (FR-032, FR-041).
      const amountChanged = ch.amountMinor !== undefined || ch.direction !== undefined || ch.accountId !== undefined || ch.currency !== undefined;
      if (amountChanged) {
        const base = await snapshotFor(ctx, c.fold, account.value, entry.value.amountMinor, entry.value.occurredUtcMs);
        if (!base.ok) return base;
        put(transactionFieldPatch({ direction: entry.value.direction, amountMinor: entry.value.amountMinor, currency: entry.value.currency, ...base.value }));
      }
      const timeChanged = ch.occurredUtcMs !== undefined || ch.tzOffsetMin !== undefined;
      if (timeChanged) {
        put(transactionFieldPatch({ occurredUtcMs: entry.value.occurredUtcMs, tzOffsetMin: entry.value.tzOffsetMin, localDate: entry.value.localDate }));
      }
      put(transactionFieldPatch({
        ...(ch.accountId !== undefined && { accountId: ch.accountId }),
        ...(ch.categoryId !== undefined && { categoryId: ch.categoryId }),
        ...(ch.payeeId !== undefined && { payeeId: ch.payeeId }),
        ...(ch.note !== undefined && { note: ch.note }),
        ...(ch.place !== undefined && { place: ch.place }),
        ...(ch.status !== undefined && { status: ch.status }),
        ...(ch.isRefund !== undefined && { isRefund: ch.isRefund }),
        ...(ch.isPinned !== undefined && { isPinned: ch.isPinned }),
        ...(ch.attachmentRef !== undefined && { attachmentRef: ch.attachmentRef }),
      }));
      const sets = ch.tagIds === undefined ? noSets : new Map<number, SetDelta>([[TXN_FIELD.tagIds, setTo(state, TXN_FIELD.tagIds, entry.value.tagIds)]]);

      if (patch.size > 0 || sets.size > 0) {
        const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.transaction, fields: patch, sets }]);
        if (!written.ok) return written as never;
        const saved = decodeTransaction(c.id, written.value[0]!.after);
        if (saved !== undefined) return ok(saved);
      }
      return ok(current);
    },
  };

  const deleteTransaction: CommandDef<{ fold: Id; id: Id }, true, NotFound> = {
    name: 'deleteTransaction',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      if (state === undefined || state.table !== TABLE.transaction || !isVisible(state)) return err('not_found', 'That transaction does not exist');
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.transaction, fields: new Map([[DELETED_FIELD, true]]), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(true as const);
    },
  };

  /** Brings a deleted transaction back, within the retention window (FR-052). */
  const restoreTransaction: CommandDef<{ fold: Id; id: Id }, true, NotFound | DomainError<'not_deleted' | 'retention_expired'>> = {
    name: 'restoreTransaction',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      if (state === undefined || state.table !== TABLE.transaction) return err('not_found', 'That transaction does not exist');
      const at = deletedAtMs(state);
      if (at === undefined) return err('not_deleted', 'That transaction is not deleted');
      if (clock.nowMs() - at > RETENTION_MS) return err('retention_expired', 'It was deleted more than 30 days ago');
      const owner = decodeTransaction(c.id, state);
      if (owner === undefined || !(await loadAccount(ctx, c.fold, owner.accountId)).ok) return err('not_found', 'Its account no longer exists');
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.transaction, fields: new Map([[DELETED_FIELD, false]]), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(true as const);
    },
  };

  return { addTransaction, updateTransaction, deleteTransaction, restoreTransaction };
}

