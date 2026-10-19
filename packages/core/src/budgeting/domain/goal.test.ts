import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays } from '../../shared-kernel/local-date';
import { date } from '../../testing/index';
import { goalProgress, monthsLeft, validateGoal, type NewGoalInput } from './goal';

const base: NewGoalInput = { name: 'Holiday', targetMinor: 600_000n, currency: 'USD', targetLocalDate: date(2027, 1, 15), accountId: 'a' as never };

describe('Goal validation', () => {
  it('needs a target above zero, a name and a known currency', () => {
    expect(validateGoal(base)).toMatchObject({ ok: true, value: { name: 'Holiday', targetMinor: 600_000n, color: 0, icon: null } });
    expect(validateGoal({ ...base, targetMinor: 0n })).toMatchObject({ ok: false, error: { code: 'invalid_target' } });
    expect(validateGoal({ ...base, targetMinor: -5n })).toMatchObject({ ok: false, error: { code: 'invalid_target' } });
    expect(validateGoal({ ...base, name: ' ' })).toMatchObject({ ok: false, error: { code: 'invalid_goal_name' } });
    expect(validateGoal({ ...base, currency: 'dollars' })).toMatchObject({ ok: false });
  });
});

describe('months left', () => {
  it('counts whole months and a month only once its day is reached, never below one', () => {
    expect(monthsLeft(date(2026, 1, 15), date(2027, 1, 15))).toBe(12);
    expect(monthsLeft(date(2026, 1, 16), date(2027, 1, 15))).toBe(11);
    expect(monthsLeft(date(2026, 1, 15), date(2026, 1, 20))).toBe(1);
    expect(monthsLeft(date(2026, 1, 15), date(2026, 1, 15))).toBe(1);
    expect(monthsLeft(date(2026, 3, 1), date(2026, 1, 1))).toBe(1);
    expect(monthsLeft(date(2026, 12, 31), date(2027, 2, 28))).toBe(1);
  });

  it('is at least one for any pair of dates', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 4000 }), fc.integer({ min: -400, max: 4000 }), (a, b) => {
      expect(monthsLeft(addDays(date(2020, 1, 1), a), addDays(date(2020, 1, 1), b))).toBeGreaterThanOrEqual(1);
    }));
  });
});

describe('goal progress (FR-068)', () => {
  const goal = { targetMinor: 600_000n, targetLocalDate: date(2027, 1, 15) };
  const today = date(2026, 1, 15);

  it('6,000.00 due in 12 months, 1,000.00 saved: 5,000.00 remaining, 16.66% and 416.67 a month rounded up', () => {
    expect(goalProgress(goal, 100_000n, today)).toEqual({
      savedMinor: 100_000n, remainingMinor: 500_000n, percent: 16, status: 'active', monthsLeft: 12, requiredPerMonthMinor: 41_667n,
    });
  });

  it('is achieved at the target and beyond, with nothing left to save', () => {
    expect(goalProgress(goal, 600_000n, today)).toMatchObject({ status: 'achieved', remainingMinor: 0n, percent: 100, requiredPerMonthMinor: 0n });
    expect(goalProgress(goal, 700_000n, today)).toMatchObject({ status: 'achieved', remainingMinor: 0n, percent: 100 });
  });

  it('is overdue after the target date unless achieved', () => {
    expect(goalProgress(goal, 100_000n, date(2027, 1, 15))).toMatchObject({ status: 'active' });
    expect(goalProgress(goal, 100_000n, date(2027, 1, 16))).toMatchObject({ status: 'overdue', monthsLeft: 1, requiredPerMonthMinor: 500_000n });
    expect(goalProgress(goal, 600_000n, date(2027, 6, 1))).toMatchObject({ status: 'achieved' });
  });

  it('treats a negative balance as nothing saved but still shows it', () => {
    expect(goalProgress(goal, -2_000n, today)).toMatchObject({ savedMinor: -2_000n, remainingMinor: 602_000n, percent: 0 });
  });

  it('rounds the monthly saving up in the smallest unit for any amounts', () => {
    fc.assert(fc.property(fc.bigInt({ min: 1n, max: 10n ** 12n }), fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.integer({ min: 1, max: 40 }), (target, saved, months) => {
      const p = goalProgress({ targetMinor: target, targetLocalDate: addDays(date(2026, 1, 1), months * 31) }, saved, date(2026, 1, 1));
      const needed = p.requiredPerMonthMinor * BigInt(p.monthsLeft);
      expect(needed).toBeGreaterThanOrEqual(p.remainingMinor);
      if (p.remainingMinor > 0n) expect(needed - p.remainingMinor).toBeLessThan(BigInt(p.monthsLeft));
      expect(p.percent).toBeGreaterThanOrEqual(0);
      expect(p.percent).toBeLessThanOrEqual(100);
    }));
  });
});
