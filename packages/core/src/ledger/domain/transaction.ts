import { parseCurrency, type CurrencyCode } from '../../shared-kernel/currency';
import type { Id } from '../../shared-kernel/id';
import { fromEpochMs, type LocalDate } from '../../shared-kernel/local-date';
import { MAX_MINOR, MIN_MINOR } from '../../shared-kernel/money';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { FieldValue } from '../../sync/domain/merge';
import type { Account } from './account';
import { TXN_FIELD } from './tables';

export const MAX_TAGS = 8;
export const MAX_NOTE = 2000;
export const MAX_PLACE_NAME = 200;
const MIN_TZ_OFFSET = -12 * 60;
const MAX_TZ_OFFSET = 14 * 60;
const MAX_LAT_E7 = 900_000_000;
const MAX_LON_E7 = 1_800_000_000;

export type TxnDirection = 'adjustment' | 'expense' | 'income';
export type TxnStatus = 'pending' | 'posted' | 'void';

const DIRECTION_CODE: Readonly<Record<TxnDirection, bigint>> = { adjustment: 0n, expense: 1n, income: 2n };
const STATUS_CODE: Readonly<Record<TxnStatus, bigint>> = { pending: 0n, posted: 1n, void: 2n };

export const txnDirectionCode = (d: TxnDirection): bigint => DIRECTION_CODE[d];
export const txnStatusCode = (s: TxnStatus): bigint => STATUS_CODE[s];
export const txnDirectionOfCode = (code: unknown): TxnDirection | undefined => (Object.keys(DIRECTION_CODE) as TxnDirection[]).find((d) => DIRECTION_CODE[d] === code);
export const txnStatusOfCode = (code: unknown): TxnStatus | undefined => (Object.keys(STATUS_CODE) as TxnStatus[]).find((s) => STATUS_CODE[s] === code);

/** Integers in 1e-7 degrees. No floating point reaches storage. */
export interface Place {
  readonly name: string;
  readonly latE7: number;
  readonly lonE7: number;
}

export interface TransactionEntryInput {
  readonly direction: TxnDirection;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly occurredUtcMs: number;
  readonly tzOffsetMin: number;
  readonly tagIds?: readonly Id[];
  readonly note?: string;
  readonly place?: Place | null;
  readonly status?: TxnStatus;
}

export interface TransactionEntry {
  readonly direction: TxnDirection;
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
  readonly occurredUtcMs: number;
  readonly tzOffsetMin: number;
  /** Derived from the instant and its own offset; never entered by hand. */
  readonly localDate: LocalDate;
  readonly tagIds: readonly Id[];
  readonly note: string;
  readonly place: Place | null;
  readonly status: TxnStatus;
}

export type TransactionError = DomainError<
  'invalid_amount_sign' | 'out_of_range' | 'currency_mismatch' | 'unknown_currency' | 'invalid_time' | 'too_many_tags' | 'note_too_long' | 'invalid_place' | 'invalid_status'
>;

export function localDateOf(occurredUtcMs: number, tzOffsetMin: number): Result<LocalDate, DomainError<'invalid_time'>> {
  const sane =
    Number.isSafeInteger(occurredUtcMs) && occurredUtcMs >= 0 && Number.isInteger(tzOffsetMin) &&
    tzOffsetMin >= MIN_TZ_OFFSET && tzOffsetMin <= MAX_TZ_OFFSET;
  if (!sane) return err('invalid_time', 'The date and time are not valid');
  try {
    return ok(fromEpochMs(occurredUtcMs, tzOffsetMin));
  } catch {
    return err('invalid_time', 'The date is outside the supported range');
  }
}

function checkPlace(place: Place): boolean {
  return (
    Array.from(place.name).length <= MAX_PLACE_NAME &&
    Number.isInteger(place.latE7) && place.latE7 >= -MAX_LAT_E7 && place.latE7 <= MAX_LAT_E7 &&
    Number.isInteger(place.lonE7) && place.lonE7 >= -MAX_LON_E7 && place.lonE7 <= MAX_LON_E7
  );
}

/** The rules a transaction entry must meet against its account (FR-030 to FR-032). */
export function validateTransactionEntry(input: TransactionEntryInput, account: Pick<Account, 'currency'>): Result<TransactionEntry, TransactionError> {
  const currency = parseCurrency(input.currency);
  if (!currency.ok) return currency;
  if (currency.value !== account.currency) return err('currency_mismatch', 'The amount must be in the account currency');
  if (input.amountMinor > MAX_MINOR || input.amountMinor < MIN_MINOR) return err('out_of_range', 'The amount is outside the supported range');

  const signOk =
    input.direction === 'expense' ? input.amountMinor < 0n :
    input.direction === 'income' ? input.amountMinor > 0n :
    input.direction === 'adjustment' ? input.amountMinor !== 0n : false;
  if (!signOk) return err('invalid_amount_sign', 'An expense is negative, income is positive and an adjustment is not zero');

  const localDate = localDateOf(input.occurredUtcMs, input.tzOffsetMin);
  if (!localDate.ok) return localDate;

  const tagIds = [...new Set(input.tagIds ?? [])];
  if (tagIds.length > MAX_TAGS) return err('too_many_tags', `A transaction has at most ${MAX_TAGS} tags`);
  const note = input.note ?? '';
  if (Array.from(note).length > MAX_NOTE) return err('note_too_long', `A note has at most ${MAX_NOTE} characters`);
  const place = input.place ?? null;
  if (place !== null && !checkPlace(place)) return err('invalid_place', 'The place is not valid');
  const status = input.status ?? 'posted';
  if (!(status in STATUS_CODE)) return err('invalid_status', 'Unknown status');

  return ok({
    direction: input.direction, amountMinor: input.amountMinor, currency: currency.value, occurredUtcMs: input.occurredUtcMs,
    tzOffsetMin: input.tzOffsetMin, localDate: localDate.value, tagIds, note, place, status,
  });
}

const ALLOWED: Readonly<Record<TxnStatus, readonly TxnStatus[]>> = {
  pending: ['pending', 'posted', 'void'],
  posted: ['posted', 'void'],
  void: ['void', 'posted'],
};

/** Pending to Posted to Void; Pending to Void; and a Void entry can be restored to Posted. */
export const canTransition = (from: TxnStatus, to: TxnStatus): boolean => ALLOWED[from].includes(to);

export interface TransactionFields extends Partial<Omit<TransactionEntry, 'tagIds'>> {
  readonly accountId?: Id;
  readonly baseAmountMinor?: bigint;
  readonly baseCurrency?: string;
  readonly fxRateId?: Id | null;
  readonly fxBaseRateId?: Id | null;
  readonly categoryId?: Id | null;
  readonly payeeId?: Id | null;
  readonly attachmentRef?: Id | null;
  readonly isRefund?: boolean;
  readonly isPinned?: boolean;
  readonly origin?: { readonly scheduleId: Id; readonly n: number } | null;
  readonly importId?: Id | null;
  // Tolerated so a validated entry can be spread in; tags are an OR-Set, written through `tagSetDelta`.
  readonly tagIds?: readonly Id[];
}

export function transactionFieldPatch(c: TransactionFields): Map<number, FieldValue> {
  const f = new Map<number, FieldValue>();
  const put = (field: number, value: FieldValue | undefined): void => {
    if (value !== undefined) f.set(field, value);
  };
  put(TXN_FIELD.accountId, c.accountId);
  put(TXN_FIELD.direction, c.direction === undefined ? undefined : txnDirectionCode(c.direction));
  put(TXN_FIELD.amountMinor, c.amountMinor);
  put(TXN_FIELD.currency, c.currency);
  put(TXN_FIELD.baseAmountMinor, c.baseAmountMinor);
  put(TXN_FIELD.baseCurrency, c.baseCurrency);
  put(TXN_FIELD.fxRateId, c.fxRateId);
  put(TXN_FIELD.fxBaseRateId, c.fxBaseRateId);
  put(TXN_FIELD.occurredUtcMs, c.occurredUtcMs === undefined ? undefined : BigInt(c.occurredUtcMs));
  put(TXN_FIELD.tzOffsetMin, c.tzOffsetMin === undefined ? undefined : BigInt(c.tzOffsetMin));
  put(TXN_FIELD.localDate, c.localDate === undefined ? undefined : BigInt(c.localDate));
  put(TXN_FIELD.categoryId, c.categoryId);
  put(TXN_FIELD.payeeId, c.payeeId);
  put(TXN_FIELD.note, c.note);
  if (c.place !== undefined) {
    put(TXN_FIELD.placeName, c.place?.name ?? null);
    put(TXN_FIELD.latE7, c.place === null ? null : BigInt(c.place.latE7));
    put(TXN_FIELD.lonE7, c.place === null ? null : BigInt(c.place.lonE7));
  }
  put(TXN_FIELD.attachmentRef, c.attachmentRef);
  put(TXN_FIELD.isRefund, c.isRefund);
  put(TXN_FIELD.isPinned, c.isPinned);
  put(TXN_FIELD.status, c.status === undefined ? undefined : txnStatusCode(c.status));
  if (c.origin !== undefined) {
    put(TXN_FIELD.originScheduleId, c.origin?.scheduleId ?? null);
    put(TXN_FIELD.originN, c.origin === null ? null : BigInt(c.origin.n));
  }
  put(TXN_FIELD.importId, c.importId);
  return f;
}
