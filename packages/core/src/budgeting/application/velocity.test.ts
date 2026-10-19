import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { date } from '../../testing/index';
import type { BudgetPeriodView } from './budget-period';
import { velocity } from './velocity';

const period = (over: Partial<BudgetPeriodView> = {}): BudgetPeriodView => ({
  budgetId: 'b' as never, index: 0, from: date(2026, 1, 1), to: date(2026, 1, 31), dayCount: 31, currency: 'USD' as never, limitMinor: 30_000n,
  allocationMinor: 30_000n, carryInMinor: 0n, spentMinor: 0n, availableMinor: 30_000n, missingRates: [], ...over,
});

describe('velocity', () => {
  it('burn is spent per elapsed day and the projection scales it to the period, half to even', () => {
    const v = velocity(period({ spentMinor: 10_000n }), 'expense', date(2026, 1, 10));
    expect(v).toMatchObject({ daysElapsed: 10, periodDays: 31, burnMinor: 1_000n, projectedMinor: 31_000n, overspend: true });
  });

  it('rounds ties to the even neighbour', () => {
    expect(velocity(period({ spentMinor: 5n }), 'expense', date(2026, 1, 2)).burnMinor).toBe(2n); // 2.5 -> 2
    expect(velocity(period({ spentMinor: 7n }), 'expense', date(2026, 1, 2)).burnMinor).toBe(4n); // 3.5 -> 4
    expect(velocity(period({ spentMinor: -5n }), 'expense', date(2026, 1, 2)).burnMinor).toBe(-2n);
  });

  it('overspend is a strict comparison with carry-in plus allocation', () => {
    const at = date(2026, 1, 10);
    expect(velocity(period({ spentMinor: 9_677n }), 'expense', at).projectedMinor).toBe(29_999n);
    expect(velocity(period({ spentMinor: 9_677n }), 'expense', at).overspend).toBe(false); // 29,998.7 -> 29,999
    expect(velocity(period({ spentMinor: 9_678n }), 'expense', at).overspend).toBe(true); // 30,001.8 -> 30,002
    expect(velocity(period({ spentMinor: 10_000n, carryInMinor: 1_000n }), 'expense', at).overspend).toBe(false);
  });

  it('counts at least one day, and never more than the period has', () => {
    expect(velocity(period({ spentMinor: 100n }), 'expense', date(2025, 12, 1)).daysElapsed).toBe(1);
    expect(velocity(period({ spentMinor: 100n }), 'expense', date(2026, 1, 1)).daysElapsed).toBe(1);
    expect(velocity(period({ spentMinor: 100n }), 'expense', date(2026, 6, 1)).daysElapsed).toBe(31);
  });

  it('income budgets never warn', () => {
    expect(velocity(period({ spentMinor: 1_000_000n }), 'income', date(2026, 1, 2)).overspend).toBe(false);
  });

  it('a period with no spending projects nothing', () => {
    expect(velocity(period(), 'expense', date(2026, 1, 15))).toMatchObject({ burnMinor: 0n, projectedMinor: 0n, overspend: false });
  });

  it('projected equals spent when the whole period has elapsed', () => {
    fc.assert(fc.property(fc.bigInt({ min: -1_000_000n, max: 1_000_000n }), (spentMinor) => {
      expect(velocity(period({ spentMinor }), 'expense', date(2026, 1, 31)).projectedMinor).toBe(spentMinor);
    }));
  });
});
