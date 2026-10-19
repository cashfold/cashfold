import { parseCurrency, type CurrencyCode } from '../../shared-kernel/currency';
import type { Id } from '../../shared-kernel/id';
import type { LocalDate } from '../../shared-kernel/local-date';
import { rate } from '../../shared-kernel/rate';
import { DELETED_FIELD, visibleMembers, type RecordState } from '../../sync/domain/merge';
import type { Account } from './account';
import { kindOfCode } from './account';
import { directionOfCode, type CategoryNode, type Direction } from './category';
import type { ExchangeRate } from './exchange-rate';
import type { Label } from './label';
import { ACCOUNT_FIELD, CATEGORY_FIELD, GROUP_FIELD, LABEL_FIELD, RATE_FIELD, TABLE, TRANSFER_FIELD, TXN_FIELD } from './tables';
import type { Transfer } from './transfer';
import { txnDirectionOfCode, txnStatusOfCode, type Place, type TxnDirection, type TxnStatus } from './transaction';

// Decoding merged record state into typed ledger records. Decoding is deliberately forgiving about *rules*
// (a merge can produce combinations no single device could) and strict about *shape*: a record whose required
// fields are missing or of the wrong type decodes to undefined and is reported by the repair rules instead.

export class Fields {
  constructor(private readonly state: RecordState) {}
  raw(field: number): unknown {
    return this.state.fields.get(field)?.value;
  }
  has(field: number): boolean {
    return this.state.fields.has(field);
  }
  text(field: number): string | undefined {
    const v = this.raw(field);
    return typeof v === 'string' ? v : undefined;
  }
  nullableText(field: number): string | null | undefined {
    const v = this.raw(field);
    return v === null || v === undefined ? null : typeof v === 'string' ? v : undefined;
  }
  big(field: number): bigint | undefined {
    const v = this.raw(field);
    return typeof v === 'bigint' ? v : undefined;
  }
  nullableBig(field: number): bigint | null | undefined {
    const v = this.raw(field);
    return v === null || v === undefined ? null : typeof v === 'bigint' ? v : undefined;
  }
  /** A small integer such as a colour, order or date. Out-of-range values read as the default. */
  int(field: number, fallback: number): number {
    const v = this.big(field);
    return v !== undefined && v >= -(2n ** 53n) && v <= 2n ** 53n ? Number(v) : fallback;
  }
  bool(field: number, fallback: boolean): boolean {
    const v = this.raw(field);
    return typeof v === 'boolean' ? v : fallback;
  }
  id(field: number): Id | null | undefined {
    const v = this.raw(field);
    return v === null || v === undefined ? null : typeof v === 'string' ? (v as Id) : undefined;
  }
}

export const isTombstoned = (state: RecordState): boolean => state.fields.get(DELETED_FIELD)?.value === true;

/** Wall-clock time (ms) of the write that last set the tombstone, or undefined if the record is not deleted. */
export function deletedAtMs(state: RecordState): number | undefined {
  const entry = state.fields.get(DELETED_FIELD);
  return entry?.value === true ? entry.hlc.wallMs : undefined;
}

/** When and on which device a record was last changed (FR-053): the newest field write that is not the tombstone alone. */
export function lastChanged(state: RecordState): { readonly dev: Id; readonly atMs: number } | undefined {
  let best: { dev: Id; atMs: number; ctr: number } | undefined;
  for (const entry of state.fields.values()) {
    const newer = best === undefined || entry.hlc.wallMs > best.atMs || (entry.hlc.wallMs === best.atMs && entry.hlc.ctr > best.ctr);
    if (newer) best = { dev: entry.dev, atMs: entry.hlc.wallMs, ctr: entry.hlc.ctr };
  }
  return best === undefined ? undefined : { dev: best.dev, atMs: best.atMs };
}

export function decodeAccount(rec: Id, state: RecordState): Account | undefined {
  if (state.table !== TABLE.account) return undefined;
  const f = new Fields(state);
  const kind = kindOfCode(f.raw(ACCOUNT_FIELD.kind));
  const name = f.text(ACCOUNT_FIELD.name);
  const currencyText = f.text(ACCOUNT_FIELD.currency);
  const currency = currencyText === undefined ? undefined : parseCurrency(currencyText);
  const opening = f.big(ACCOUNT_FIELD.openingBalanceMinor);
  const openingDate = f.int(ACCOUNT_FIELD.openingDate, 0);
  const creditLimitMinor = f.nullableBig(ACCOUNT_FIELD.creditLimitMinor);
  if (kind === undefined || name === undefined || currency === undefined || !currency.ok || opening === undefined || openingDate === 0 || creditLimitMinor === undefined) return undefined;
  return {
    id: rec, kind, name, currency: currency.value, openingBalanceMinor: opening, openingDate: openingDate as LocalDate,
    includeInNetWorth: f.bool(ACCOUNT_FIELD.includeInNetWorth, true), creditLimitMinor, icon: f.nullableText(ACCOUNT_FIELD.icon) ?? null,
    color: f.int(ACCOUNT_FIELD.color, 0), sortOrder: f.int(ACCOUNT_FIELD.sortOrder, 0), archived: f.bool(ACCOUNT_FIELD.archived, false),
    groupIds: [...visibleMembers(state, ACCOUNT_FIELD.groupIds)].sort(),
  };
}

export interface AccountGroup {
  readonly id: Id;
  readonly name: string;
  readonly icon: string | null;
  readonly color: number;
  readonly sortOrder: number;
}

export function decodeGroup(rec: Id, state: RecordState): AccountGroup | undefined {
  if (state.table !== TABLE.accountGroup) return undefined;
  const f = new Fields(state);
  const name = f.text(GROUP_FIELD.name);
  if (name === undefined) return undefined;
  return { id: rec, name, icon: f.nullableText(GROUP_FIELD.icon) ?? null, color: f.int(GROUP_FIELD.color, 0), sortOrder: f.int(GROUP_FIELD.sortOrder, 0) };
}

export interface Category extends CategoryNode {
  readonly name: string;
  readonly icon: string | null;
  readonly color: number;
  readonly sortOrder: number;
  readonly archived: boolean;
}

export function decodeCategory(rec: Id, state: RecordState): Category | undefined {
  if (state.table !== TABLE.category) return undefined;
  const f = new Fields(state);
  const direction: Direction | undefined = directionOfCode(f.raw(CATEGORY_FIELD.direction));
  const name = f.text(CATEGORY_FIELD.name);
  const parentId = f.id(CATEGORY_FIELD.parentId);
  if (direction === undefined || name === undefined || parentId === undefined) return undefined;
  return {
    id: rec, direction, parentId, name, icon: f.nullableText(CATEGORY_FIELD.icon) ?? null, color: f.int(CATEGORY_FIELD.color, 0),
    sortOrder: f.int(CATEGORY_FIELD.sortOrder, 0), archived: f.bool(CATEGORY_FIELD.archived, false),
  };
}

export function decodeLabel(rec: Id, state: RecordState, table: typeof TABLE.payee | typeof TABLE.tag): Label | undefined {
  if (state.table !== table) return undefined;
  const f = new Fields(state);
  const name = f.text(LABEL_FIELD.name);
  return name === undefined ? undefined : { id: rec, name, color: f.int(LABEL_FIELD.color, 0) };
}

export interface Transaction {
  readonly id: Id;
  readonly accountId: Id;
  readonly direction: TxnDirection;
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
  readonly baseAmountMinor: bigint;
  readonly baseCurrency: CurrencyCode;
  readonly fxRateId: Id | null;
  readonly fxBaseRateId: Id | null;
  readonly occurredUtcMs: number;
  readonly tzOffsetMin: number;
  readonly localDate: LocalDate;
  readonly categoryId: Id | null;
  readonly payeeId: Id | null;
  readonly tagIds: readonly Id[];
  readonly note: string;
  readonly place: Place | null;
  readonly attachmentRef: Id | null;
  readonly isRefund: boolean;
  readonly isPinned: boolean;
  readonly status: TxnStatus;
  readonly origin: { readonly scheduleId: Id; readonly n: number } | null;
  readonly importId: Id | null;
}

export function decodeTransaction(rec: Id, state: RecordState): Transaction | undefined {
  if (state.table !== TABLE.transaction) return undefined;
  const f = new Fields(state);
  const accountId = f.id(TXN_FIELD.accountId);
  const direction = txnDirectionOfCode(f.raw(TXN_FIELD.direction));
  const amountMinor = f.big(TXN_FIELD.amountMinor);
  const currency = parseCurrency(f.text(TXN_FIELD.currency) ?? '');
  // A missing snapshot means "same as the amount"; a snapshot of the wrong type is a malformed record, not a missing one.
  const baseCurrency = f.has(TXN_FIELD.baseCurrency) ? parseCurrency(f.text(TXN_FIELD.baseCurrency) ?? '') : currency;
  const baseAmountMinor = f.has(TXN_FIELD.baseAmountMinor) ? f.big(TXN_FIELD.baseAmountMinor) : amountMinor;
  const status = txnStatusOfCode(f.raw(TXN_FIELD.status) ?? 1n);
  const localDate = f.int(TXN_FIELD.localDate, 0);
  if (
    accountId === null || accountId === undefined || direction === undefined || amountMinor === undefined || !currency.ok ||
    !baseCurrency.ok || baseAmountMinor === undefined || status === undefined || localDate === 0
  ) return undefined;

  const placeName = f.nullableText(TXN_FIELD.placeName);
  const lat = f.nullableBig(TXN_FIELD.latE7);
  const lon = f.nullableBig(TXN_FIELD.lonE7);
  const place: Place | null = placeName !== null && placeName !== undefined && lat != null && lon != null
    ? { name: placeName, latE7: Number(lat), lonE7: Number(lon) } : null;
  const scheduleId = f.id(TXN_FIELD.originScheduleId);
  const originN = f.nullableBig(TXN_FIELD.originN);

  return {
    id: rec, accountId, direction, amountMinor, currency: currency.value, baseAmountMinor, baseCurrency: baseCurrency.value,
    fxRateId: f.id(TXN_FIELD.fxRateId) ?? null, fxBaseRateId: f.id(TXN_FIELD.fxBaseRateId) ?? null, occurredUtcMs: f.int(TXN_FIELD.occurredUtcMs, 0), tzOffsetMin: f.int(TXN_FIELD.tzOffsetMin, 0),
    localDate: localDate as LocalDate, categoryId: f.id(TXN_FIELD.categoryId) ?? null, payeeId: f.id(TXN_FIELD.payeeId) ?? null,
    tagIds: [...visibleMembers(state, TXN_FIELD.tagIds)].sort(), note: f.text(TXN_FIELD.note) ?? '', place,
    attachmentRef: f.id(TXN_FIELD.attachmentRef) ?? null, isRefund: f.bool(TXN_FIELD.isRefund, false), isPinned: f.bool(TXN_FIELD.isPinned, false),
    status,
    origin: scheduleId != null && originN != null ? { scheduleId, n: Number(originN) } : null,
    importId: f.id(TXN_FIELD.importId) ?? null,
  };
}

export function decodeExchangeRate(rec: Id, state: RecordState): ExchangeRate | undefined {
  if (state.table !== TABLE.exchangeRate) return undefined;
  const f = new Fields(state);
  const quote = parseCurrency(f.text(RATE_FIELD.quote) ?? '');
  const asOf = f.big(RATE_FIELD.asOfUtcS);
  const value = f.big(RATE_FIELD.rateE12);
  const source = f.text(RATE_FIELD.source);
  if (!quote.ok || asOf === undefined || value === undefined || (source !== 'service' && source !== 'custom')) return undefined;
  const r = rate(value);
  if (!r.ok) return undefined;
  return { id: rec, quote: quote.value, asOfUtcS: Number(asOf), rateE12: r.value, source };
}

export function decodeTransfer(rec: Id, state: RecordState): Transfer | undefined {
  if (state.table !== TABLE.transfer) return undefined;
  const f = new Fields(state);
  const fromAccountId = f.id(TRANSFER_FIELD.fromAccountId);
  const toAccountId = f.id(TRANSFER_FIELD.toAccountId);
  const fromAmountMinor = f.big(TRANSFER_FIELD.fromAmountMinor);
  const toAmountMinor = f.big(TRANSFER_FIELD.toAmountMinor);
  const status = txnStatusOfCode(f.raw(TRANSFER_FIELD.status) ?? 1n);
  const localDate = f.int(TRANSFER_FIELD.localDate, 0);
  if (
    fromAccountId == null || toAccountId == null || fromAmountMinor === undefined || toAmountMinor === undefined || status === undefined || localDate === 0
  ) return undefined;
  return {
    id: rec, fromAccountId, toAccountId, fromAmountMinor, toAmountMinor, status, localDate: localDate as LocalDate,
    occurredUtcMs: f.int(TRANSFER_FIELD.occurredUtcMs, 0), tzOffsetMin: f.int(TRANSFER_FIELD.tzOffsetMin, 0),
    note: f.text(TRANSFER_FIELD.note) ?? '', fxRateId: f.id(TRANSFER_FIELD.fxRateId) ?? null,
  };
}
