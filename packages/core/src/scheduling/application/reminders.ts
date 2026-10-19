import type { Id } from '../../shared-kernel/id';
import type { LocalDate } from '../../shared-kernel/local-date';
import { dayOf, monthOf, yearOf } from '../../shared-kernel/local-date';
import type { Schedule, ScheduleTemplate } from '../domain/schedule';
import { upcomingOccurrences } from './projected-balance';

// Reminders are worked out from the schedules alone, so any device can show them while the app is open and nothing
// about them is sent anywhere. The platform adapter decides how to display one and remembers which it has shown.

export interface Reminder {
  /** Stable for one occurrence, so an adapter can remember that it has been shown. */
  readonly key: string;
  readonly scheduleId: Id;
  readonly name: string;
  readonly n: number;
  readonly localDate: LocalDate;
  readonly fireAtMs: number;
  readonly template: ScheduleTemplate;
  readonly requiresConfirmation: boolean;
}

const MS_PER_MINUTE = 60_000;
const startOfDayMs = (d: LocalDate, tzOffsetMin: number): number => Date.UTC(yearOf(d), monthOf(d) - 1, dayOf(d)) - tzOffsetMin * MS_PER_MINUTE;

/** Reminders whose time has come and whose occurrence has not yet been dealt with. A reminder is due from `reminder_min` before the start of the day until the day ends. */
export function dueReminders(schedules: Iterable<Schedule>, existing: ReadonlySet<Id>, nowMs: number, tzOffsetMin: number, lookaheadDays = 31): Reminder[] {
  const horizon = new Date(nowMs + lookaheadDays * 24 * 60 * MS_PER_MINUTE + tzOffsetMin * MS_PER_MINUTE);
  const until = (horizon.getUTCFullYear() * 10_000 + (horizon.getUTCMonth() + 1) * 100 + horizon.getUTCDate()) as LocalDate;
  const withReminder = [...schedules].filter((s) => s.reminderMin !== null);
  const byId = new Map(withReminder.map((s) => [s.id, s]));
  const out: Reminder[] = [];
  for (const u of upcomingOccurrences(withReminder, existing, until)) {
    const s = byId.get(u.scheduleId)!;
    const fireAtMs = startOfDayMs(u.localDate, tzOffsetMin) - (s.reminderMin ?? 0) * MS_PER_MINUTE;
    const endOfDayMs = startOfDayMs(u.localDate, tzOffsetMin) + 24 * 60 * MS_PER_MINUTE;
    if (fireAtMs <= nowMs && nowMs < endOfDayMs) {
      out.push({ key: `${u.scheduleId}:${u.n}`, scheduleId: u.scheduleId, name: u.name, n: u.n, localDate: u.localDate, fireAtMs, template: u.template, requiresConfirmation: u.requiresConfirmation });
    }
  }
  return out.sort((a, b) => a.fireAtMs - b.fireAtMs || (a.key < b.key ? -1 : 1));
}
