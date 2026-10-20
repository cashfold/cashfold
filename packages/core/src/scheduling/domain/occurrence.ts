import { uuidV5Bytes, type Id } from '../../shared-kernel/id';
import { addDays, addMonths, daysBetween, type LocalDate } from '../../shared-kernel/local-date';

// Occurrence dates are computed from the schedule's begin date, never from the previous occurrence, so a series that
// starts on the 31st returns to the 31st after a short month instead of drifting to the 28th (FR-063, ARCH 4.4).

export const RECURRENCE_UNITS = ['day', 'week', 'month', 'year'] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export interface Recurrence {
  readonly begin: LocalDate;
  readonly unit: RecurrenceUnit;
  readonly interval: number;
}

/** The date of occurrence `n` (0 is the begin date). */
export function occurrence(r: Recurrence, n: number): LocalDate {
  const steps = n * r.interval;
  switch (r.unit) {
    case 'day': return addDays(r.begin, steps);
    case 'week': return addDays(r.begin, steps * 7);
    case 'month': return addMonths(r.begin, steps);
    case 'year': return addMonths(r.begin, steps * 12);
  }
}

/**
 * Indexes of the occurrences dated on or before `until` (and on or before `end`, when there is one), in order.
 * Capped, so a schedule that began far in the past with a one-day interval cannot stall the device.
 */
export function occurrencesUntil(r: Recurrence, until: LocalDate, end: LocalDate | null, limit = 5_000): number[] {
  const last = end !== null && end < until ? end : until;
  if (last < r.begin) return [];
  // Occurrences never come earlier than the straight-line estimate, so start the scan there (months are at most 31 days).
  const days = daysBetween(r.begin, last);
  const perOccurrence = r.interval * (r.unit === 'day' ? 1 : r.unit === 'week' ? 7 : r.unit === 'month' ? 28 : 365);
  const out: number[] = [];
  const upperBound = Number(BigInt(days) / BigInt(perOccurrence)) + 2;
  for (let n = 0; n <= upperBound && out.length < limit; n++) {
    if (occurrence(r, n) <= last) out.push(n);
    else break;
  }
  return out;
}

/** The record id of occurrence `n`: the same on every device, so two devices that both create it merge into one record (FR-064). */
export function occurrenceId(schedule: Id, n: number): Id {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n, false);
  return uuidV5Bytes(schedule, bytes);
}
