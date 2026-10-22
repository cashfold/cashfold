import { describe, expect, it } from 'vitest';
import { groupByDay } from './day-groups';

const row = (id: string, localDate: number, amountMinor: bigint) => ({ id, localDate, amountMinor });

describe('groupByDay', () => {
  const rows = [row('a', 20250302, -500n), row('b', 20250302, 1200n), row('c', 20250301, -99n)];
  it('groups consecutive rows by date and sums signed minor units exactly', () => {
    const groups = groupByDay(rows, rows.length);
    expect(groups.map((g) => [g.date, g.items.length, g.netMinor])).toEqual([[20250302, 2, 700n], [20250301, 1, -99n]]);
  });
  it('keeps sums exact beyond 2^53', () => {
    const big = [row('a', 20250302, 9_007_199_254_740_993n), row('b', 20250302, 1n)];
    expect(groupByDay(big, 2)[0]!.netMinor).toBe(9_007_199_254_740_994n);
  });
  it('marks only the last group partial, and only while more rows exist than are loaded', () => {
    expect(groupByDay(rows, 10).map((g) => g.partial)).toEqual([false, true]);
    expect(groupByDay(rows, 3).map((g) => g.partial)).toEqual([false, false]);
  });
  it('handles no rows', () => {
    expect(groupByDay([], 0)).toEqual([]);
  });
});
