import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, compare, dayOf, daysBetween, daysInMonth, fromEpochMs, isLeapYear, localDate, monthOf, yearOf,
} from './local-date';

const D = (y: number, m: number, d: number) => {
  const r = localDate(y, m, d);
  if (!r.ok) throw new Error(`bad date ${y}-${m}-${d}`);
  return r.value;
};

describe('LocalDate', () => {
  it('is an integer yyyymmdd', () => {
    expect(D(2026, 10, 18)).toBe(20261018);
    expect([yearOf(D(2026, 10, 18)), monthOf(D(2026, 10, 18)), dayOf(D(2026, 10, 18))]).toEqual([2026, 10, 18]);
  });

  it('validates calendar dates', () => {
    expect(localDate(2026, 2, 29).ok).toBe(false);
    expect(localDate(2024, 2, 29).ok).toBe(true);
    expect(localDate(2026, 13, 1).ok).toBe(false);
    expect(localDate(2026, 0, 1).ok).toBe(false);
    expect(localDate(2026, 4, 31).ok).toBe(false);
    expect(localDate(0, 1, 1).ok).toBe(false);
    expect(localDate(10000, 1, 1).ok).toBe(false);
  });

  it('knows leap years and month lengths', () => {
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('adds days across month, year and leap boundaries', () => {
    expect(addDays(D(2026, 1, 31), 1)).toBe(D(2026, 2, 1));
    expect(addDays(D(2026, 12, 31), 1)).toBe(D(2027, 1, 1));
    expect(addDays(D(2024, 2, 28), 1)).toBe(D(2024, 2, 29));
    expect(addDays(D(2026, 3, 1), -1)).toBe(D(2026, 2, 28));
    expect(addDays(D(2026, 10, 18), 365)).toBe(D(2027, 10, 18));
  });

  it('adds months clamping to the end of shorter months', () => {
    expect(addMonths(D(2026, 1, 31), 1)).toBe(D(2026, 2, 28));
    expect(addMonths(D(2024, 1, 31), 1)).toBe(D(2024, 2, 29));
    expect(addMonths(D(2026, 11, 30), 3)).toBe(D(2027, 2, 28));
    expect(addMonths(D(2026, 3, 31), -1)).toBe(D(2026, 2, 28));
    expect(addMonths(D(2026, 1, 15), 12)).toBe(D(2027, 1, 15));
  });

  it('counts days between and compares', () => {
    expect(daysBetween(D(2026, 1, 1), D(2026, 1, 31))).toBe(30);
    expect(daysBetween(D(2026, 3, 1), D(2026, 2, 1))).toBe(-28);
    expect(compare(D(2026, 1, 1), D(2026, 1, 2))).toBeLessThan(0);
    expect(compare(D(2026, 1, 1), D(2026, 1, 1))).toBe(0);
  });

  it('derives the local date from utc_ms and tz offset minutes', () => {
    const utc = Date.UTC(2026, 9, 18, 23, 30); // 2026-10-18 23:30Z
    expect(fromEpochMs(utc, 0)).toBe(D(2026, 10, 18));
    expect(fromEpochMs(utc, 60)).toBe(D(2026, 10, 19));
    expect(fromEpochMs(utc, -300)).toBe(D(2026, 10, 18));
    expect(fromEpochMs(Date.UTC(2026, 9, 18, 0, 30), -60)).toBe(D(2026, 10, 17));
  });

  it('property: addDays/daysBetween agree and addDays(n) then (-n) is the identity', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1900, max: 2200 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }), fc.integer({ min: -4000, max: 4000 }), (y, m, d, n) => {
        const start = D(y, m, d);
        const end = addDays(start, n);
        expect(daysBetween(start, end)).toBe(n);
        expect(addDays(end, -n)).toBe(start);
      }),
    );
  });
});
