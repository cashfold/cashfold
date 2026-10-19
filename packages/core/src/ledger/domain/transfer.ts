import type { Id } from '../../shared-kernel/id';
import type { LocalDate } from '../../shared-kernel/local-date';
import { MAX_MINOR } from '../../shared-kernel/money';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { FieldValue } from '../../sync/domain/merge';
import { checkEntryAllowed, type Account, type EntryError } from './account';
import { TRANSFER_FIELD } from './tables';
import { localDateOf, MAX_NOTE, txnStatusCode, type TxnStatus } from './transaction';

// A transfer is one record with two amounts, never two linked transactions (FR-043). Each side keeps the amount the
// person confirmed: a cross-currency amount is never worked out from the other side (FR-044).

export interface TransferInput {
  readonly fromAmountMinor: bigint;
  readonly toAmountMinor: bigint;
  readonly occurredUtcMs: number;
  readonly tzOffsetMin: number;
  readonly note?: string;
  readonly status?: TxnStatus;
}

export interface TransferEntry {
  readonly fromAmountMinor: bigint;
  readonly toAmountMinor: bigint;
  readonly occurredUtcMs: number;
  readonly tzOffsetMin: number;
  readonly localDate: LocalDate;
  readonly note: string;
  readonly status: TxnStatus;
}

export interface Transfer extends TransferEntry {
  readonly id: Id;
  readonly fromAccountId: Id;
  readonly toAccountId: Id;
  /** The exchange rate the person based the amounts on, if any: provenance only, never used to compute. */
  readonly fxRateId: Id | null;
}

export type TransferError =
  | EntryError
  | DomainError<'same_account' | 'invalid_transfer_amount' | 'amounts_must_match' | 'out_of_range' | 'invalid_time' | 'note_too_long' | 'invalid_status'>;

export function validateTransfer(input: TransferInput, from: Account, to: Account): Result<TransferEntry, TransferError> {
  if (from.id === to.id) return err('same_account', 'A transfer needs two different accounts');
  if (input.fromAmountMinor <= 0n || input.toAmountMinor <= 0n) return err('invalid_transfer_amount', 'Both amounts must be greater than zero');
  if (input.fromAmountMinor > MAX_MINOR || input.toAmountMinor > MAX_MINOR) return err('out_of_range', 'An amount is outside the supported range');
  if (from.currency === to.currency && input.fromAmountMinor !== input.toAmountMinor) {
    return err('amounts_must_match', 'Accounts in the same currency exchange equal amounts');
  }
  const localDate = localDateOf(input.occurredUtcMs, input.tzOffsetMin);
  if (!localDate.ok) return localDate;
  const note = input.note ?? '';
  if (Array.from(note).length > MAX_NOTE) return err('note_too_long', `A note has at most ${MAX_NOTE} characters`);
  const status = input.status ?? 'posted';
  if (status !== 'pending' && status !== 'posted' && status !== 'void') return err('invalid_status', 'Unknown status');

  const out = checkEntryAllowed(from, 'transfer_out', localDate.value);
  if (!out.ok) return out;
  const incoming = checkEntryAllowed(to, 'transfer_in', localDate.value);
  if (!incoming.ok) return incoming;

  return ok({
    fromAmountMinor: input.fromAmountMinor, toAmountMinor: input.toAmountMinor, occurredUtcMs: input.occurredUtcMs,
    tzOffsetMin: input.tzOffsetMin, localDate: localDate.value, note, status,
  });
}

export interface TransferFields extends Partial<TransferEntry> {
  readonly fromAccountId?: Id;
  readonly toAccountId?: Id;
  readonly fxRateId?: Id | null;
}

export function transferFieldPatch(c: TransferFields): Map<number, FieldValue> {
  const f = new Map<number, FieldValue>();
  const put = (field: number, value: FieldValue | undefined): void => {
    if (value !== undefined) f.set(field, value);
  };
  put(TRANSFER_FIELD.fromAccountId, c.fromAccountId);
  put(TRANSFER_FIELD.toAccountId, c.toAccountId);
  put(TRANSFER_FIELD.fromAmountMinor, c.fromAmountMinor);
  put(TRANSFER_FIELD.toAmountMinor, c.toAmountMinor);
  put(TRANSFER_FIELD.fxRateId, c.fxRateId);
  put(TRANSFER_FIELD.occurredUtcMs, c.occurredUtcMs === undefined ? undefined : BigInt(c.occurredUtcMs));
  put(TRANSFER_FIELD.tzOffsetMin, c.tzOffsetMin === undefined ? undefined : BigInt(c.tzOffsetMin));
  put(TRANSFER_FIELD.localDate, c.localDate === undefined ? undefined : BigInt(c.localDate));
  put(TRANSFER_FIELD.note, c.note);
  put(TRANSFER_FIELD.status, c.status === undefined ? undefined : txnStatusCode(c.status));
  return f;
}
