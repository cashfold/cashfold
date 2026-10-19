import { describe, expect, it } from 'vitest';
import { LedgerFixture, date, id } from '../../testing/index';
import { TABLE } from '../../ledger/domain/tables';
import { occurrenceId } from '../domain/occurrence';
import { scheduleFieldPatch, templateFieldPatch } from '../domain/schedule';
import { buildSchedules, recordIds } from './projected-balance';
import { dueReminders } from './reminders';

function setup(reminderMin: number | null) {
  const f = new LedgerFixture();
  const a = f.account();
  const rec = id(0x60);
  f.apply(rec, TABLE.schedule, new Map([
    ...scheduleFieldPatch({ name: 'Rent', beginLocalDate: date(2026, 3, 10), endLocalDate: null, unit: 'month', interval: 1, requiresConfirmation: false, reminderMin, completedUtcMs: null }),
    ...templateFieldPatch({ kind: 'transaction', direction: 'expense', accountId: a, amountMinor: -100n, categoryId: null, payeeId: null, tagIds: [], note: '' }),
  ]));
  return { f, rec };
}
const due = (f: LedgerFixture, nowMs: number, tz = 0) => dueReminders(buildSchedules(f.fold).values(), recordIds(f.fold), nowMs, tz);

describe('reminders', () => {
  it('fire from the set time before the day starts until the day ends, once per occurrence', () => {
    const { f, rec } = setup(60);
    const midnight = Date.UTC(2026, 2, 10);
    expect(due(f, midnight - 61 * 60_000)).toEqual([]);
    expect(due(f, midnight - 59 * 60_000)).toMatchObject([{ key: `${rec}:0`, name: 'Rent', localDate: date(2026, 3, 10), fireAtMs: midnight - 60 * 60_000 }]);
    expect(due(f, midnight + 23 * 3_600_000)).toHaveLength(1);
    expect(due(f, midnight + 25 * 3_600_000)).toEqual([]);
  });

  it('use the device offset to find the start of the day', () => {
    const { f } = setup(0);
    const startInTokyo = Date.UTC(2026, 2, 10) - 9 * 3_600_000;
    expect(due(f, startInTokyo - 1, 9 * 60)).toEqual([]);
    expect(due(f, startInTokyo, 9 * 60)).toHaveLength(1);
  });

  it('are absent without a reminder setting, after the occurrence exists, and for finished schedules', () => {
    const none = setup(null);
    expect(due(none.f, Date.UTC(2026, 2, 10, 8))).toEqual([]);
    const made = setup(0);
    made.f.transaction(made.f.nextId(), {}, occurrenceId(made.rec, 0));
    expect(due(made.f, Date.UTC(2026, 2, 10, 8))).toEqual([]);
    const finished = setup(0);
    finished.f.apply(finished.rec, TABLE.schedule, scheduleFieldPatch({ completedUtcMs: 1 }));
    expect(due(finished.f, Date.UTC(2026, 2, 10, 8))).toEqual([]);
  });
});
