import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LedgerFixture, date } from '../../testing/index';
import { buildLedger } from '../../ledger/application/projections/ledger';
import { TABLE } from '../../ledger/domain/tables';
import { MAX_MINOR } from '../../shared-kernel/money';
import { addDays } from '../../shared-kernel/local-date';
import { occurrenceId } from '../domain/occurrence';
import { scheduleFieldPatch, templateFieldPatch, type ScheduleTemplate } from '../domain/schedule';
import { buildSchedules, DEFAULT_HORIZON_DAYS, projectedBalance, recordIds, upcomingOccurrences } from './projected-balance';

function world(opening = 100_000n) {
  const f = new LedgerFixture();
  const main = f.account({ openingBalanceMinor: opening, openingDate: date(2020, 1, 1) });
  const savings = f.account({ name: 'Savings', openingBalanceMinor: 0n, openingDate: date(2020, 1, 1) });
  const schedule = (template: ScheduleTemplate, over: Partial<Parameters<typeof scheduleFieldPatch>[0]> = {}, rec = f.nextId()) => {
    const fields = new Map([
      ...scheduleFieldPatch({ name: 'S', beginLocalDate: date(2026, 1, 31), endLocalDate: null, unit: 'month', interval: 1, requiresConfirmation: false, reminderMin: null, completedUtcMs: null, ...over }),
      ...templateFieldPatch(template),
    ]);
    f.apply(rec, TABLE.schedule, fields);
    return rec;
  };
  const expense = (amountMinor: bigint): ScheduleTemplate => ({ kind: 'transaction', direction: 'expense', accountId: main, amountMinor, categoryId: null, payeeId: null, tagIds: [], note: '' });
  const project = (account: typeof main, asOf: ReturnType<typeof date>) => {
    const ledger = buildLedger(f.fold);
    return projectedBalance(ledger, buildSchedules(f.fold).values(), recordIds(f.fold), account, asOf);
  };
  return { f, main, savings, schedule, expense, project };
}

describe('projected balance including scheduled (FR-066)', () => {
  it('adds each future occurrence up to the date, and no more', () => {
    const w = world();
    w.schedule(w.expense(-50_000n));
    expect(w.project(w.main, date(2026, 1, 30))).toEqual({ ok: true, value: 100_000n });
    expect(w.project(w.main, date(2026, 1, 31))).toEqual({ ok: true, value: 50_000n });
    expect(w.project(w.main, date(2026, 3, 31))).toEqual({ ok: true, value: 100_000n - 150_000n });
  });

  it('counts a transfer on both accounts', () => {
    const w = world();
    w.schedule({ kind: 'transfer', fromAccountId: w.main, toAccountId: w.savings, fromAmountMinor: 1_000n, toAmountMinor: 1_000n, note: '' });
    expect(w.project(w.main, date(2026, 2, 28))).toEqual({ ok: true, value: 98_000n });
    expect(w.project(w.savings, date(2026, 2, 28))).toEqual({ ok: true, value: 2_000n });
  });

  it('includes pending entries and excludes void ones', () => {
    const w = world();
    w.f.transaction(w.main, { amountMinor: -1_000n, status: 'pending', localDate: date(2026, 1, 5) });
    w.f.transaction(w.main, { amountMinor: -9_000n, status: 'void', localDate: date(2026, 1, 5) });
    expect(w.project(w.main, date(2026, 1, 10))).toEqual({ ok: true, value: 99_000n });
  });

  it('does not count an occurrence twice once it exists as a record, whatever its status', () => {
    const w = world();
    const s = w.schedule(w.expense(-50_000n));
    w.f.transaction(w.main, { amountMinor: -50_000n, localDate: date(2026, 1, 31) }, occurrenceId(s, 0));
    expect(w.project(w.main, date(2026, 1, 31))).toEqual({ ok: true, value: 50_000n });
    w.f.edit(occurrenceId(s, 0), TABLE.transaction, new Map([[21, 2n]])); // void: skipped
    expect(w.project(w.main, date(2026, 1, 31))).toEqual({ ok: true, value: 100_000n });
  });

  it('ignores finished schedules and stops at the end date', () => {
    const w = world();
    w.schedule(w.expense(-1_000n), { endLocalDate: date(2026, 2, 28) });
    w.schedule(w.expense(-7_000n), { completedUtcMs: 5 });
    expect(w.project(w.main, date(2026, 12, 31))).toEqual({ ok: true, value: 98_000n });
  });

  it('is refused rather than wrapped when it passes 64 bits', () => {
    const w = world(MAX_MINOR - 10n);
    w.schedule({ kind: 'transaction', direction: 'income', accountId: w.main, amountMinor: 100n, categoryId: null, payeeId: null, tagIds: [], note: '' });
    expect(w.project(w.main, date(2026, 1, 31))).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
    expect(w.project(w.main, date(2026, 1, 30))).toMatchObject({ ok: true });
  });

  it('refuses an unknown account', () => {
    const w = world();
    expect(w.project(w.f.nextId(), date(2026, 1, 31))).toMatchObject({ ok: false, error: { code: 'unknown_account' } });
  });

  it('equals the posted balance plus the exact sum of the occurrences, for any horizon', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 28 }), fc.integer({ min: 1, max: 3 }), fc.integer({ min: 0, max: 400 }), (day, interval, span) => {
      const w = world();
      w.schedule(w.expense(-1_234n), { beginLocalDate: date(2026, 1, day), interval });
      const asOf = addDays(date(2026, 1, 1), span);
      const listed = upcomingOccurrences(buildSchedules(w.f.fold).values(), recordIds(w.f.fold), asOf).length;
      expect(w.project(w.main, asOf)).toEqual({ ok: true, value: 100_000n - 1_234n * BigInt(listed) });
    }));
  });
});

describe('upcoming', () => {
  it('lists occurrences with no record yet, oldest first, across schedules', () => {
    const w = world();
    w.schedule(w.expense(-1n), { name: 'A', beginLocalDate: date(2026, 2, 10), unit: 'week' });
    w.schedule(w.expense(-1n), { name: 'B', beginLocalDate: date(2026, 2, 12), unit: 'month' });
    const list = upcomingOccurrences(buildSchedules(w.f.fold).values(), recordIds(w.f.fold), date(2026, 3, 1));
    expect(list.map((u) => [u.name, u.localDate])).toEqual([['A', date(2026, 2, 10)], ['B', date(2026, 2, 12)], ['A', date(2026, 2, 17)], ['A', date(2026, 2, 24)]]);
  });

  it('defaults to a 90-day horizon', () => {
    expect(DEFAULT_HORIZON_DAYS).toBe(90);
  });
});
