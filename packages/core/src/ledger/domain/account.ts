import { parseCurrency, type CurrencyCode } from '../../shared-kernel/currency';
import type { Id } from '../../shared-kernel/id';
import type { LocalDate } from '../../shared-kernel/local-date';
import { MAX_MINOR, MIN_MINOR } from '../../shared-kernel/money';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { FieldValue } from '../../sync/domain/merge';
import { ACCOUNT_FIELD } from './tables';

export const MAX_ACCOUNT_NAME = 80;

export const ACCOUNT_KINDS = ['checking', 'savings', 'credit_card', 'cash', 'goal', 'loan'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
const KIND_CODE: Readonly<Record<AccountKind, bigint>> = { checking: 1n, savings: 2n, credit_card: 3n, cash: 4n, goal: 5n, loan: 6n };

export const kindCode = (kind: AccountKind): bigint => KIND_CODE[kind];
export function kindOfCode(code: unknown): AccountKind | undefined {
  return ACCOUNT_KINDS.find((k) => KIND_CODE[k] === code);
}

const HAS_CREDIT_LIMIT: ReadonlySet<AccountKind> = new Set(['credit_card', 'loan']);

export interface AccountFields {
  readonly kind: AccountKind;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly openingBalanceMinor: bigint;
  readonly openingDate: LocalDate;
  readonly includeInNetWorth: boolean;
  readonly creditLimitMinor: bigint | null;
  readonly icon: string | null;
  readonly color: number;
  readonly sortOrder: number;
  readonly archived: boolean;
}

export interface Account extends AccountFields {
  readonly id: Id;
  /** Groups the account belongs to (an add-wins set on the record). */
  readonly groupIds: readonly Id[];
}

export interface NewAccountInput {
  readonly kind: AccountKind;
  readonly name: string;
  readonly currency: string;
  readonly openingBalanceMinor: bigint;
  readonly openingDate: LocalDate;
  readonly includeInNetWorth?: boolean;
  readonly creditLimitMinor?: bigint | null;
  readonly icon?: string | null;
  readonly color?: number;
  readonly sortOrder?: number;
}

export type AccountError = DomainError<
  'invalid_kind' | 'invalid_account_name' | 'unknown_currency' | 'out_of_range' | 'credit_limit_not_allowed' | 'invalid_credit_limit' | 'currency_locked'
>;

/** A one-line text of 1 to `max` characters, trimmed. Characters are code points, not UTF-16 units. */
export function cleanName(text: string, max: number): string | undefined {
  const name = text.trim();
  const length = Array.from(name).length;
  return length < 1 || length > max || /\p{Cc}/u.test(name) ? undefined : name;
}

const inRange = (v: bigint): boolean => v >= MIN_MINOR && v <= MAX_MINOR;

function validate(input: NewAccountInput & { archived?: boolean }): Result<AccountFields, AccountError> {
  if (!ACCOUNT_KINDS.includes(input.kind)) return err('invalid_kind', 'Unknown account kind');
  const name = cleanName(input.name, MAX_ACCOUNT_NAME);
  if (name === undefined) return err('invalid_account_name', `An account name has 1 to ${MAX_ACCOUNT_NAME} characters and no line breaks`);
  const currency = parseCurrency(input.currency);
  if (!currency.ok) return currency;
  if (!inRange(input.openingBalanceMinor)) return err('out_of_range', 'The opening balance is outside the supported range');
  const creditLimitMinor = input.creditLimitMinor ?? null;
  if (creditLimitMinor !== null) {
    if (!HAS_CREDIT_LIMIT.has(input.kind)) return err('credit_limit_not_allowed', 'Only credit cards and loans have a credit limit');
    if (creditLimitMinor < 0n || !inRange(creditLimitMinor)) return err('invalid_credit_limit', 'A credit limit is zero or more');
  }
  return ok({
    kind: input.kind, name, currency: currency.value, openingBalanceMinor: input.openingBalanceMinor, openingDate: input.openingDate,
    includeInNetWorth: input.includeInNetWorth ?? true, creditLimitMinor, icon: input.icon ?? null, color: input.color ?? 0,
    sortOrder: input.sortOrder ?? 0, archived: input.archived ?? false,
  });
}

export const validateNewAccount = (input: NewAccountInput): Result<AccountFields, AccountError> => validate(input);

export type AccountChanges = Partial<Omit<NewAccountInput, 'currency'> & { currency: string; archived: boolean }>;

/** Applies edits and re-checks every rule. The currency is locked once any entry (transaction or transfer leg) exists. */
export function validateAccountUpdate(current: AccountFields, changes: AccountChanges, state: { hasEntries: boolean }): Result<AccountFields, AccountError> {
  if (changes.currency !== undefined && changes.currency !== current.currency && state.hasEntries) {
    return err('currency_locked', 'The currency cannot change once the account has entries');
  }
  return validate({ ...current, ...changes });
}

export type EntryKind = 'income' | 'expense' | 'adjustment' | 'transfer_in' | 'transfer_out';
export type EntryError = DomainError<'account_archived' | 'goal_entries_restricted' | 'before_opening_date'>;

/** Whether a new entry may be booked on the account on that date (invariants 5, FR-029). */
export function checkEntryAllowed(account: Pick<Account, 'kind' | 'archived' | 'openingDate'>, entry: EntryKind, on: LocalDate): Result<true, EntryError> {
  if (account.archived) return err('account_archived', 'An archived account accepts no new entries');
  if (account.kind === 'goal' && (entry === 'income' || entry === 'expense')) {
    return err('goal_entries_restricted', 'A goal account takes only transfers and balance adjustments');
  }
  if (on < account.openingDate) return err('before_opening_date', 'The entry is dated before the account opened');
  return ok(true as const);
}

export function accountFieldPatch(changes: Partial<AccountFields>): Map<number, FieldValue> {
  const f = new Map<number, FieldValue>();
  if (changes.kind !== undefined) f.set(ACCOUNT_FIELD.kind, kindCode(changes.kind));
  if (changes.name !== undefined) f.set(ACCOUNT_FIELD.name, changes.name);
  if (changes.currency !== undefined) f.set(ACCOUNT_FIELD.currency, changes.currency);
  if (changes.openingBalanceMinor !== undefined) f.set(ACCOUNT_FIELD.openingBalanceMinor, changes.openingBalanceMinor);
  if (changes.openingDate !== undefined) f.set(ACCOUNT_FIELD.openingDate, BigInt(changes.openingDate));
  if (changes.includeInNetWorth !== undefined) f.set(ACCOUNT_FIELD.includeInNetWorth, changes.includeInNetWorth);
  if (changes.creditLimitMinor !== undefined) f.set(ACCOUNT_FIELD.creditLimitMinor, changes.creditLimitMinor);
  if (changes.icon !== undefined) f.set(ACCOUNT_FIELD.icon, changes.icon);
  if (changes.color !== undefined) f.set(ACCOUNT_FIELD.color, BigInt(changes.color));
  if (changes.sortOrder !== undefined) f.set(ACCOUNT_FIELD.sortOrder, BigInt(changes.sortOrder));
  if (changes.archived !== undefined) f.set(ACCOUNT_FIELD.archived, changes.archived);
  return f;
}
