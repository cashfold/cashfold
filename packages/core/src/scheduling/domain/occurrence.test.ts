import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, type LocalDate } from '../../shared-kernel/local-date';
import { parseId } from '../../shared-kernel/id';
import { date } from '../../testing/index';
import { occurrence, occurrenceId, occurrencesUntil, type Recurrence } from './occurrence';

interface Vectors {
  cases: Array<{ name: string; begin: number; unit: Recurrence['unit']; interval: number; occurrences: number[] }>;
  ids: { schedule: string; vectors: Array<{ n: number; id: string }> };
}
const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../../vectors/recurrence/occurrences.json'), 'utf8')) as Vectors;

describe('occurrence dates match the independent reference (FR-063)', () => {
  it.each(vectors.cases)('$name', ({ begin, unit, interval, occurrences }) => {
    const r: Recurrence = { begin: begin as LocalDate, unit, interval };
    expect(occurrences.map((_, n) => occurrence(r, n))).toEqual(occurrences);
  });

  it('31 Jan monthly gives 28 Feb (29 in a leap year), 31 Mar, 30 Apr, and returns to the 31st', () => {
    const r: Recurrence = { begin: date(2027, 1, 31), unit: 'month', interval: 1 };
    expect([0, 1, 2, 3, 4].map((n) => occurrence(r, n))).toEqual([date(2027, 1, 31), date(2027, 2, 28), date(2027, 3, 31), date(2027, 4, 30), date(2027, 5, 31)]);
    expect(occurrence({ ...r, begin: date(2028, 1, 31) }, 1)).toBe(date(2028, 2, 29));
  });

  it('yearly on 29 Feb gives 28 Feb in common years and 29 Feb in leap years', () => {
    const r: Recurrence = { begin: date(2024, 2, 29), unit: 'year', interval: 1 };
    expect([0, 1, 2, 3, 4].map((n) => occurrence(r, n))).toEqual([date(2024, 2, 29), date(2025, 2, 28), date(2026, 2, 28), date(2027, 2, 28), date(2028, 2, 29)]);
  });

  it('calendar dates do not move with daylight saving: weekly across a clock change stays on the same weekday', () => {
    const r: Recurrence = { begin: date(2026, 3, 25), unit: 'week', interval: 1 };
    expect([0, 1, 2].map((n) => occurrence(r, n))).toEqual([date(2026, 3, 25), date(2026, 4, 1), date(2026, 4, 8)]);
  });
});

describe('occurrence properties', () => {
  const recurrence = fc.record({
    begin: fc.tuple(fc.integer({ min: 2000, max: 2060 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 31 })).map(([y, m, d]) => {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return date(y, m, Math.min(d, last));
    }),
    unit: fc.constantFrom('day', 'week', 'month', 'year' as const),
    interval: fc.integer({ min: 1, max: 24 }),
  }) as fc.Arbitrary<Recurrence>;

  it('occurrences strictly increase from the begin date, and the first is the begin date', () => {
    fc.assert(fc.property(recurrence, (r) => {
      expect(occurrence(r, 0)).toBe(r.begin);
      for (let n = 1; n < 30; n++) expect(occurrence(r, n)).toBeGreaterThan(occurrence(r, n - 1));
    }));
  });

  it('a monthly or yearly occurrence falls on the begin day or the last day of a shorter month', () => {
    fc.assert(fc.property(recurrence.filter((r) => r.unit === 'month' || r.unit === 'year'), fc.nat(60), (r, n) => {
      const day = occurrence(r, n) % 100;
      const wanted = r.begin % 100;
      expect(day === wanted || (day < wanted && addDays(occurrence(r, n), 1) % 100 === 1)).toBe(true);
    }));
  });

  it('day and week units step by exact day counts', () => {
    fc.assert(fc.property(recurrence.filter((r) => r.unit === 'day' || r.unit === 'week'), fc.nat(200), (r, n) => {
      expect(daysBetween(r.begin, occurrence(r, n))).toBe(n * r.interval * (r.unit === 'week' ? 7 : 1));
    }));
  });

  it('occurrencesUntil lists exactly the occurrences on or before the limit and the end date', () => {
    fc.assert(fc.property(recurrence, fc.nat(3000), fc.option(fc.nat(2000), { nil: undefined }), (r, span, endSpan) => {
      const until = addDays(r.begin, span);
      const end = endSpan === undefined ? null : addDays(r.begin, endSpan);
      const listed = occurrencesUntil(r, until, end);
      const limit = end !== null && end < until ? end : until;
      const expected: number[] = [];
      for (let n = 0; n < 5_000 && occurrence(r, n) <= limit; n++) expected.push(n);
      expect(listed).toEqual(expected);
    }), { numRuns: 100 });
  });

  it('nothing is due before the begin date', () => {
    expect(occurrencesUntil({ begin: date(2026, 5, 1), unit: 'day', interval: 1 }, date(2026, 4, 30), null)).toEqual([]);
  });
});

describe('occurrence ids (FR-064)', () => {
  it('match the reference UUIDv5 of the schedule id and n as a big-endian u32', () => {
    const schedule = parseId(vectors.ids.schedule);
    if (!schedule.ok) throw new Error('bad vector');
    for (const v of vectors.ids.vectors) expect(occurrenceId(schedule.value, v.n)).toBe(v.id);
  });

  it('differ by occurrence and by schedule', () => {
    const a = parseId(vectors.ids.schedule);
    const b = parseId('00000000-0000-4000-8000-0000000000a2');
    if (!a.ok || !b.ok) throw new Error('bad ids');
    expect(new Set([occurrenceId(a.value, 0), occurrenceId(a.value, 1), occurrenceId(b.value, 0)]).size).toBe(3);
  });
});
