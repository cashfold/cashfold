import type { Id } from '../../shared-kernel/id';
import type { LocalDate } from '../../shared-kernel/local-date';
import { MAX_MINOR } from '../../shared-kernel/money';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { FieldValue, RecordState } from '../../sync/domain/merge';
import { visibleMembers } from '../../sync/domain/merge';
import { cleanName } from '../../ledger/domain/account';
import { Fields } from '../../ledger/domain/records';
import { SCHEDULE_FIELD, TABLE } from '../../ledger/domain/tables';
import { MAX_NOTE, txnDirectionCode, txnDirectionOfCode, MAX_TAGS, type TxnDirection } from '../../ledger/domain/transaction';
import { RECURRENCE_UNITS, type RecurrenceUnit } from './occurrence';

export const MAX_SCHEDULE_NAME = 80;
export const MAX_INTERVAL = 1000;

/** What a scheduled transaction creates each time: the same fields as an ordinary entry. */
export interface TransactionTemplate {
  readonly kind: 'transaction';
  readonly direction: Exclude<TxnDirection, 'adjustment'>;
  readonly accountId: Id;
  readonly amountMinor: bigint;
  readonly categoryId: Id | null;
  readonly payeeId: Id | null;
  readonly tagIds: readonly Id[];
  readonly note: string;
}

export interface TransferTemplate {
  readonly kind: 'transfer';
  readonly fromAccountId: Id;
  readonly toAccountId: Id;
  readonly fromAmountMinor: bigint;
  readonly toAmountMinor: bigint;
  readonly note: string;
}

export type ScheduleTemplate = TransactionTemplate | TransferTemplate;

export interface ScheduleFields {
  readonly name: string;
  readonly beginLocalDate: LocalDate;
  readonly endLocalDate: LocalDate | null;
  readonly unit: RecurrenceUnit;
  readonly interval: number;
  readonly requiresConfirmation: boolean;
  /** Minutes before the occurrence to remind, or null for no reminder. */
  readonly reminderMin: number | null;
}

export interface Schedule extends ScheduleFields {
  readonly id: Id;
  readonly template: ScheduleTemplate;
  /** Set when the series is finished; no occurrence is created after that. */
  readonly completedUtcMs: number | null;
}

export type ScheduleError = DomainError<
  'invalid_schedule_name' | 'invalid_unit' | 'invalid_interval' | 'invalid_end_date' | 'invalid_reminder' | 'invalid_template_direction' |
  'invalid_template_amount' | 'same_account' | 'amounts_must_match' | 'note_too_long' | 'too_many_tags'
>;

export type ScheduleInput = Omit<ScheduleFields, 'requiresConfirmation' | 'reminderMin' | 'endLocalDate'> &
  Partial<Pick<ScheduleFields, 'requiresConfirmation' | 'reminderMin' | 'endLocalDate'>>;

export function validateSchedule(input: ScheduleInput, template: ScheduleTemplate): Result<ScheduleFields, ScheduleError> {
  const name = cleanName(input.name, MAX_SCHEDULE_NAME);
  if (name === undefined) return err('invalid_schedule_name', `A schedule name has 1 to ${MAX_SCHEDULE_NAME} characters and no line breaks`);
  if (!RECURRENCE_UNITS.includes(input.unit)) return err('invalid_unit', 'A schedule repeats by day, week, month or year');
  if (!Number.isInteger(input.interval) || input.interval < 1 || input.interval > MAX_INTERVAL) return err('invalid_interval', 'A schedule repeats every 1 or more days, weeks, months or years');
  const endLocalDate = input.endLocalDate ?? null;
  if (endLocalDate !== null && endLocalDate < input.beginLocalDate) return err('invalid_end_date', 'The end date cannot be before the start date');
  const reminderMin = input.reminderMin ?? null;
  if (reminderMin !== null && (!Number.isInteger(reminderMin) || reminderMin < 0 || reminderMin > 60 * 24 * 30)) return err('invalid_reminder', 'A reminder is 0 minutes to 30 days before');
  const checked = validateTemplate(template);
  if (!checked.ok) return checked;
  return ok({
    name, beginLocalDate: input.beginLocalDate, endLocalDate, unit: input.unit, interval: input.interval,
    requiresConfirmation: input.requiresConfirmation ?? false, reminderMin,
  });
}

export function validateTemplate(t: ScheduleTemplate): Result<ScheduleTemplate, ScheduleError> {
  if (Array.from(t.note).length > MAX_NOTE) return err('note_too_long', `A note has at most ${MAX_NOTE} characters`);
  if (t.kind === 'transaction') {
    if (t.direction !== 'expense' && t.direction !== 'income') return err('invalid_template_direction', 'A schedule creates expenses, income or transfers');
    const sign = t.direction === 'expense' ? t.amountMinor < 0n : t.amountMinor > 0n;
    if (!sign || t.amountMinor > MAX_MINOR || t.amountMinor < -MAX_MINOR) return err('invalid_template_amount', 'An expense is below zero and income is above zero');
    if (t.tagIds.length > MAX_TAGS) return err('too_many_tags', `A transaction has at most ${MAX_TAGS} tags`);
    return ok(t);
  }
  if (t.fromAccountId === t.toAccountId) return err('same_account', 'A transfer needs two different accounts');
  if (t.fromAmountMinor <= 0n || t.toAmountMinor <= 0n || t.fromAmountMinor > MAX_MINOR || t.toAmountMinor > MAX_MINOR) {
    return err('invalid_template_amount', 'Both amounts must be greater than zero');
  }
  return ok(t);
}

const KIND_CODE = { transaction: 1n, transfer: 2n } as const;
const UNIT_CODE: Readonly<Record<RecurrenceUnit, bigint>> = { day: 1n, week: 2n, month: 3n, year: 4n };
const unitOfCode = (code: unknown): RecurrenceUnit | undefined => RECURRENCE_UNITS.find((u) => UNIT_CODE[u] === code);

export function scheduleFieldPatch(changes: Partial<ScheduleFields> & { completedUtcMs?: number | null }): Map<number, FieldValue> {
  const f = new Map<number, FieldValue>();
  if (changes.name !== undefined) f.set(SCHEDULE_FIELD.name, changes.name);
  if (changes.beginLocalDate !== undefined) f.set(SCHEDULE_FIELD.beginLocalDate, BigInt(changes.beginLocalDate));
  if (changes.endLocalDate !== undefined) f.set(SCHEDULE_FIELD.endLocalDate, changes.endLocalDate === null ? null : BigInt(changes.endLocalDate));
  if (changes.unit !== undefined) f.set(SCHEDULE_FIELD.unit, UNIT_CODE[changes.unit]);
  if (changes.interval !== undefined) f.set(SCHEDULE_FIELD.interval, BigInt(changes.interval));
  if (changes.requiresConfirmation !== undefined) f.set(SCHEDULE_FIELD.requiresConfirmation, changes.requiresConfirmation);
  if (changes.reminderMin !== undefined) f.set(SCHEDULE_FIELD.reminderMin, changes.reminderMin === null ? null : BigInt(changes.reminderMin));
  if (changes.completedUtcMs !== undefined) f.set(SCHEDULE_FIELD.completedUtcMs, changes.completedUtcMs === null ? null : BigInt(changes.completedUtcMs));
  return f;
}

/**
 * The fields of a template. The group it belongs to is always written whole, so a concurrent edit of the amount and of
 * the account cannot be torn apart (FR-032), and switching kind clears the other kind's fields.
 */
export function templateFieldPatch(t: ScheduleTemplate): Map<number, FieldValue> {
  const f = new Map<number, FieldValue>([[SCHEDULE_FIELD.kind, KIND_CODE[t.kind]], [SCHEDULE_FIELD.note, t.note]]);
  if (t.kind === 'transaction') {
    f.set(SCHEDULE_FIELD.direction, txnDirectionCode(t.direction));
    f.set(SCHEDULE_FIELD.accountId, t.accountId);
    f.set(SCHEDULE_FIELD.amountMinor, t.amountMinor);
    f.set(SCHEDULE_FIELD.categoryId, t.categoryId);
    f.set(SCHEDULE_FIELD.payeeId, t.payeeId);
  } else {
    f.set(SCHEDULE_FIELD.fromAccountId, t.fromAccountId);
    f.set(SCHEDULE_FIELD.toAccountId, t.toAccountId);
    f.set(SCHEDULE_FIELD.fromAmountMinor, t.fromAmountMinor);
    f.set(SCHEDULE_FIELD.toAmountMinor, t.toAmountMinor);
  }
  return f;
}

export function decodeSchedule(rec: Id, state: RecordState): Schedule | undefined {
  if (state.table !== TABLE.schedule) return undefined;
  const f = new Fields(state);
  const name = f.text(SCHEDULE_FIELD.name);
  const unit = unitOfCode(f.raw(SCHEDULE_FIELD.unit));
  const begin = f.int(SCHEDULE_FIELD.beginLocalDate, 0);
  const end = f.nullableBig(SCHEDULE_FIELD.endLocalDate);
  const reminder = f.nullableBig(SCHEDULE_FIELD.reminderMin);
  const completed = f.nullableBig(SCHEDULE_FIELD.completedUtcMs);
  const kind = f.raw(SCHEDULE_FIELD.kind);
  if (name === undefined || unit === undefined || begin === 0 || end === undefined || reminder === undefined || completed === undefined) return undefined;

  let template: ScheduleTemplate | undefined;
  const note = f.text(SCHEDULE_FIELD.note) ?? '';
  if (kind === KIND_CODE.transaction) {
    const direction = txnDirectionOfCode(f.raw(SCHEDULE_FIELD.direction));
    const accountId = f.id(SCHEDULE_FIELD.accountId);
    const amountMinor = f.big(SCHEDULE_FIELD.amountMinor);
    if (direction !== undefined && direction !== 'adjustment' && accountId != null && amountMinor !== undefined) {
      template = {
        kind: 'transaction', direction, accountId, amountMinor, categoryId: f.id(SCHEDULE_FIELD.categoryId) ?? null,
        payeeId: f.id(SCHEDULE_FIELD.payeeId) ?? null, tagIds: [...visibleMembers(state, SCHEDULE_FIELD.tagIds)].sort(), note,
      };
    }
  } else if (kind === KIND_CODE.transfer) {
    const fromAccountId = f.id(SCHEDULE_FIELD.fromAccountId);
    const toAccountId = f.id(SCHEDULE_FIELD.toAccountId);
    const fromAmountMinor = f.big(SCHEDULE_FIELD.fromAmountMinor);
    const toAmountMinor = f.big(SCHEDULE_FIELD.toAmountMinor);
    if (fromAccountId != null && toAccountId != null && fromAmountMinor !== undefined && toAmountMinor !== undefined) {
      template = { kind: 'transfer', fromAccountId, toAccountId, fromAmountMinor, toAmountMinor, note };
    }
  }
  if (template === undefined) return undefined;
  const interval = f.int(SCHEDULE_FIELD.interval, 1);
  return {
    id: rec, name, template, beginLocalDate: begin as LocalDate, endLocalDate: end === null ? null : (Number(end) as LocalDate), unit,
    interval: interval >= 1 ? interval : 1, requiresConfirmation: f.bool(SCHEDULE_FIELD.requiresConfirmation, false),
    reminderMin: reminder === null ? null : Number(reminder), completedUtcMs: completed === null ? null : Number(completed),
  };
}
