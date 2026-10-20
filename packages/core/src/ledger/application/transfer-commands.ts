import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError } from '../../shared-kernel/result';
import type { CommandDef } from '../../sync/application/buses';
import { DELETED_FIELD, isVisible } from '../../sync/domain/merge';
import type { ClockPort } from '../../sync/ports/index';
import { decodeTransfer, deletedAtMs } from '../domain/records';
import { TABLE, TRANSFER_GROUP } from '../domain/tables';
import { canTransition, type TxnStatus } from '../domain/transaction';
import { transferFieldPatch, validateTransfer, type Transfer, type TransferError } from '../domain/transfer';
import { loadAccount, noSets, type NotFound } from './context';
import { RETENTION_MS } from './transaction-commands';

export type TransferCommandError = TransferError | NotFound | DomainError<'transfer_exists' | 'invalid_status_change' | 'not_deleted' | 'retention_expired'>;

export interface AddTransferCommand {
  readonly fold: Id;
  readonly id: Id;
  readonly fromAccountId: Id;
  readonly toAccountId: Id;
  readonly fromAmountMinor: bigint;
  readonly toAmountMinor: bigint;
  readonly occurredUtcMs: number;
  readonly tzOffsetMin: number;
  readonly note?: string;
  readonly status?: TxnStatus;
  readonly fxRateId?: Id | null;
}

export interface TransferChanges {
  readonly fromAccountId?: Id;
  readonly toAccountId?: Id;
  readonly fromAmountMinor?: bigint;
  readonly toAmountMinor?: bigint;
  readonly occurredUtcMs?: number;
  readonly tzOffsetMin?: number;
  readonly note?: string;
  readonly status?: TxnStatus;
  readonly fxRateId?: Id | null;
}

export function createTransferCommands({ clock }: { clock: ClockPort }) {
  /** One op that carries the whole amount group, so no device can ever see half a transfer (FR-043, FR-045). */
  const addTransfer: CommandDef<AddTransferCommand, Transfer, TransferCommandError> = {
    name: 'addTransfer',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      if ((await ctx.reader.getRecord(c.fold, c.id)) !== undefined) return err('transfer_exists', 'A transfer with this id already exists');
      const from = await loadAccount(ctx, c.fold, c.fromAccountId);
      if (!from.ok) return from;
      const to = await loadAccount(ctx, c.fold, c.toAccountId);
      if (!to.ok) return to;
      const entry = validateTransfer(c, from.value, to.value);
      if (!entry.ok) return entry;
      const fields = transferFieldPatch({ ...entry.value, fromAccountId: c.fromAccountId, toAccountId: c.toAccountId, fxRateId: c.fxRateId ?? null });
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.transfer, fields, sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(decodeTransfer(c.id, written.value[0]!.after)!);
    },
  };

  const updateTransfer: CommandDef<{ fold: Id; id: Id; changes: TransferChanges }, Transfer, TransferCommandError> = {
    name: 'updateTransfer',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      const current = state !== undefined && state.table === TABLE.transfer && isVisible(state) ? decodeTransfer(c.id, state) : undefined;
      if (current === undefined) return err('not_found', 'That transfer does not exist');
      const ch = c.changes;
      const from = await loadAccount(ctx, c.fold, ch.fromAccountId ?? current.fromAccountId);
      if (!from.ok) return from;
      const to = await loadAccount(ctx, c.fold, ch.toAccountId ?? current.toAccountId);
      if (!to.ok) return to;
      if (ch.status !== undefined && !canTransition(current.status, ch.status)) return err('invalid_status_change', 'That status change is not allowed');

      const merged = {
        fromAmountMinor: ch.fromAmountMinor ?? current.fromAmountMinor,
        toAmountMinor: ch.toAmountMinor ?? current.toAmountMinor,
        occurredUtcMs: ch.occurredUtcMs ?? current.occurredUtcMs,
        tzOffsetMin: ch.tzOffsetMin ?? current.tzOffsetMin,
        note: ch.note ?? current.note,
        status: ch.status ?? current.status,
      };
      const entry = validateTransfer(merged, from.value, to.value);
      if (!entry.ok) return entry;

      const patch = new Map<number, import('../../sync/domain/merge').FieldValue>();
      const groupTouched = ch.fromAccountId !== undefined || ch.toAccountId !== undefined || ch.fromAmountMinor !== undefined || ch.toAmountMinor !== undefined || ch.fxRateId !== undefined;
      if (groupTouched) {
        // The whole group goes in one write, even the parts that did not change, so merging can never mix two versions.
        for (const [k, v] of transferFieldPatch({
          fromAccountId: from.value.id, toAccountId: to.value.id, fromAmountMinor: entry.value.fromAmountMinor, toAmountMinor: entry.value.toAmountMinor,
          fxRateId: ch.fxRateId === undefined ? current.fxRateId : ch.fxRateId,
        })) patch.set(k, v);
      }
      if (ch.occurredUtcMs !== undefined || ch.tzOffsetMin !== undefined) {
        for (const [k, v] of transferFieldPatch({ occurredUtcMs: entry.value.occurredUtcMs, tzOffsetMin: entry.value.tzOffsetMin, localDate: entry.value.localDate })) patch.set(k, v);
      }
      for (const [k, v] of transferFieldPatch({ ...(ch.note !== undefined && { note: ch.note }), ...(ch.status !== undefined && { status: ch.status }) })) patch.set(k, v);

      if (patch.size === 0) return ok(current);
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.transfer, fields: patch, sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(decodeTransfer(c.id, written.value[0]!.after)!);
    },
  };

  const deleteTransfer: CommandDef<{ fold: Id; id: Id }, true, NotFound> = {
    name: 'deleteTransfer',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      if (state === undefined || state.table !== TABLE.transfer || !isVisible(state)) return err('not_found', 'That transfer does not exist');
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.transfer, fields: new Map([[DELETED_FIELD, true]]), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(true as const);
    },
  };

  /** Brings back both sides at once, within the 30 days (FR-045, FR-052). */
  const restoreTransfer: CommandDef<{ fold: Id; id: Id }, true, NotFound | DomainError<'not_deleted' | 'retention_expired'>> = {
    name: 'restoreTransfer',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      if (state === undefined || state.table !== TABLE.transfer) return err('not_found', 'That transfer does not exist');
      const at = deletedAtMs(state);
      if (at === undefined) return err('not_deleted', 'That transfer is not deleted');
      if (clock.nowMs() - at > RETENTION_MS) return err('retention_expired', 'It was deleted more than 30 days ago');
      const transfer = decodeTransfer(c.id, state);
      if (transfer === undefined || !(await loadAccount(ctx, c.fold, transfer.fromAccountId)).ok || !(await loadAccount(ctx, c.fold, transfer.toAccountId)).ok) {
        return err('not_found', 'One of its accounts no longer exists');
      }
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.transfer, fields: new Map([[DELETED_FIELD, false]]), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(true as const);
    },
  };

  return { addTransfer, updateTransfer, deleteTransfer, restoreTransfer, group: TRANSFER_GROUP };
}
