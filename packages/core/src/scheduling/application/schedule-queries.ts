import type { Id } from '../../shared-kernel/id';
import { fromEpochMs, type LocalDate } from '../../shared-kernel/local-date';
import type { QueryDef } from '../../sync/application/buses';
import { occurrenceId, occurrencesUntil } from '../domain/occurrence';
import type { LedgerViews } from '../../ledger/application/views';
import type { ClockPort } from '../../sync/ports/index';
import type { Transaction } from '../../ledger/domain/records';
import type { Transfer } from '../../ledger/domain/transfer';
import type { Schedule } from '../domain/schedule';
import { buildSchedules, DEFAULT_HORIZON_DAYS, horizonEnd, projectedBalance, recordIds, upcomingOccurrences, type Upcoming } from './projected-balance';
import { dueReminders, type Reminder } from './reminders';

export interface ScheduleRow extends Schedule {
  /** The next occurrence that has no record yet, if the series is still running. */
  readonly next: LocalDate | undefined;
}

export interface PendingOccurrence {
  readonly scheduleId: Id;
  readonly scheduleName: string;
  readonly n: number;
  readonly record: Transaction | Transfer;
}

export interface ScheduleQueryDeps {
  readonly views: LedgerViews;
  readonly clock: ClockPort;
}

export function createScheduleQueries({ views, clock }: ScheduleQueryDeps) {
  const todayOf = (tz: number | undefined): LocalDate => fromEpochMs(clock.nowMs(), tz ?? 0);

  const listSchedules: QueryDef<{ fold: Id; tzOffsetMin?: number }, ScheduleRow[]> = {
    name: 'listSchedules', requires: 'viewer', foldOf: (q) => q.fold,
    async read(q, ctx) {
      const records = await ctx.reader.listRecords(q.fold);
      const schedules = buildSchedules(records);
      const existing = recordIds(records);
      const today = todayOf(q.tzOffsetMin);
      return [...schedules.values()].map((s) => {
        const next = s.completedUtcMs !== null ? undefined : upcomingOccurrences([s], existing, horizonEnd(today, 366 * 5))[0];
        return { ...s, next: next?.localDate };
      });
    },
  };

  /** What is coming up: occurrences with no record yet, from today to the horizon. */
  const upcoming: QueryDef<{ fold: Id; tzOffsetMin?: number; horizonDays?: number }, Upcoming[]> = {
    name: 'upcoming', requires: 'viewer', foldOf: (q) => q.fold,
    async read(q, ctx) {
      const records = await ctx.reader.listRecords(q.fold);
      const today = todayOf(q.tzOffsetMin);
      return upcomingOccurrences(buildSchedules(records).values(), recordIds(records), horizonEnd(today, q.horizonDays ?? DEFAULT_HORIZON_DAYS)).filter((u) => u.localDate >= today);
    },
  };

  /** Occurrences waiting for the person to confirm them. */
  const pendingConfirmations: QueryDef<{ fold: Id; tzOffsetMin?: number }, PendingOccurrence[]> = {
    name: 'pendingConfirmations', requires: 'viewer', foldOf: (q) => q.fold,
    async read(q, ctx) {
      const [view, records] = await Promise.all([views.get(q.fold, ctx.reader), ctx.reader.listRecords(q.fold)]);
      const out: PendingOccurrence[] = [];
      const today = todayOf(q.tzOffsetMin);
      for (const s of buildSchedules(records).values()) {
        if (!s.requiresConfirmation) continue;
        for (const t of view.ledger.transactions.values()) {
          if (t.origin?.scheduleId === s.id && t.status === 'pending') out.push({ scheduleId: s.id, scheduleName: s.name, n: t.origin.n, record: t });
        }
        // A transfer carries no origin, so its occurrences are found by their derived ids.
        if (s.template.kind === 'transfer') {
          for (const n of occurrencesUntil({ begin: s.beginLocalDate, unit: s.unit, interval: s.interval }, today, s.endLocalDate)) {
            const x = view.ledger.transfers.get(occurrenceId(s.id, n));
            if (x?.status === 'pending') out.push({ scheduleId: s.id, scheduleName: s.name, n, record: x });
          }
        }
      }
      return out.sort((a, b) => a.record.localDate - b.record.localDate);
    },
  };

  /** Balance on a date including pending entries and scheduled occurrences up to it (FR-066). */
  const projectedBalanceQuery: QueryDef<{ fold: Id; account: Id; asOf: LocalDate }, bigint | undefined> = {
    name: 'projectedBalance', requires: 'viewer', foldOf: (q) => q.fold,
    async read(q, ctx) {
      const [view, records] = await Promise.all([views.get(q.fold, ctx.reader), ctx.reader.listRecords(q.fold)]);
      const r = projectedBalance(view.ledger, buildSchedules(records).values(), recordIds(records), q.account, q.asOf);
      return r.ok ? r.value : undefined;
    },
  };

  const reminders: QueryDef<{ fold: Id; tzOffsetMin?: number }, Reminder[]> = {
    name: 'reminders', requires: 'viewer', foldOf: (q) => q.fold,
    async read(q, ctx) {
      const records = await ctx.reader.listRecords(q.fold);
      return dueReminders(buildSchedules(records).values(), recordIds(records), clock.nowMs(), q.tzOffsetMin ?? 0);
    },
  };

  return { listSchedules, upcoming, pendingConfirmations, projectedBalance: projectedBalanceQuery, reminders };
}
