import type { Id } from '../../shared-kernel/id';
import { addDays, type LocalDate } from '../../shared-kernel/local-date';
import { MAX_MINOR, MIN_MINOR } from '../../shared-kernel/money';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import { isVisible, type FoldState } from '../../sync/domain/merge';
import { TABLE } from '../../ledger/domain/tables';
import { accountBalance } from '../../ledger/application/balance';
import type { Ledger } from '../../ledger/application/projections/ledger';
import { occurrence, occurrenceId, occurrencesUntil } from '../domain/occurrence';
import { decodeSchedule, type Schedule, type ScheduleTemplate } from '../domain/schedule';

/** The horizon of "upcoming" and of projected balances unless the person picks another (FR-066). */
export const DEFAULT_HORIZON_DAYS = 90;

/** All visible schedules of a Fold, by name then id. */
export function buildSchedules(records: FoldState): ReadonlyMap<Id, Schedule> {
  const list: Schedule[] = [];
  for (const [rec, state] of records) {
    if (state.table !== TABLE.schedule || !isVisible(state)) continue;
    const s = decodeSchedule(rec, state);
    if (s !== undefined) list.push(s);
  }
  list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(list.map((s) => [s.id, s]));
}

/** Every record id in the Fold, deleted or not: an occurrence whose record exists in any state has been dealt with. */
export const recordIds = (records: FoldState): ReadonlySet<Id> => new Set(records.keys());

export interface Upcoming {
  readonly scheduleId: Id;
  readonly name: string;
  readonly n: number;
  readonly localDate: LocalDate;
  readonly template: ScheduleTemplate;
  readonly requiresConfirmation: boolean;
}

/**
 * The occurrences dated on or before `until` that have no record yet, oldest first. These are virtual: nothing is
 * stored for them, and they are worked out again on every call (ARCH 4.4).
 */
export function upcomingOccurrences(schedules: Iterable<Schedule>, existing: ReadonlySet<Id>, until: LocalDate): Upcoming[] {
  const out: Upcoming[] = [];
  for (const s of schedules) {
    if (s.completedUtcMs !== null) continue;
    for (const n of occurrencesUntil({ begin: s.beginLocalDate, unit: s.unit, interval: s.interval }, until, s.endLocalDate)) {
      if (existing.has(occurrenceId(s.id, n))) continue;
      out.push({ scheduleId: s.id, name: s.name, n, localDate: occurrenceDate(s, n), template: s.template, requiresConfirmation: s.requiresConfirmation });
    }
  }
  return out.sort((a, b) => a.localDate - b.localDate || (a.scheduleId < b.scheduleId ? -1 : a.scheduleId > b.scheduleId ? 1 : 0) || a.n - b.n);
}

const occurrenceDate = (s: Schedule, n: number): LocalDate => occurrence({ begin: s.beginLocalDate, unit: s.unit, interval: s.interval }, n);

export const horizonEnd = (today: LocalDate, days: number = DEFAULT_HORIZON_DAYS): LocalDate => addDays(today, days);

export type ProjectionError = DomainError<'unknown_account' | 'out_of_range'>;

/**
 * "Including scheduled" (FR-066): the posted balance on `asOf`, plus pending entries dated up to then, plus the
 * scheduled occurrences up to then that are not yet records. Exact, and refused rather than wrapped beyond 64 bits.
 */
export function projectedBalance(ledger: Ledger, schedules: Iterable<Schedule>, existing: ReadonlySet<Id>, account: Id, asOf: LocalDate): Result<bigint, ProjectionError> {
  const posted = accountBalance(ledger, account, asOf);
  if (!posted.ok) return posted;
  let sum = posted.value;
  for (const e of ledger.entriesByAccount.get(account) ?? []) if (e.status === 'pending' && e.localDate <= asOf) sum += e.amountMinor;
  for (const u of upcomingOccurrences(schedules, existing, asOf)) {
    const t = u.template;
    if (t.kind === 'transaction') {
      if (t.accountId === account) sum += t.amountMinor;
    } else {
      if (t.fromAccountId === account) sum -= t.fromAmountMinor;
      if (t.toAccountId === account) sum += t.toAmountMinor;
    }
  }
  return sum >= MIN_MINOR && sum <= MAX_MINOR ? ok(sum) : err('out_of_range', 'The balance is outside the supported range');
}
