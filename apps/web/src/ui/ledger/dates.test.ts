import { describe, expect, it } from 'vitest';
import { dateOfUtcSeconds, dateToInput, deviceOffsetAt, startOfDayUtcS, startOfLocalDayUtcS, localDateOfUtcSeconds, formatDate, inputToDate, inputToMoment, momentToInput, nowInput, todayLocal } from './dates';

describe('civil dates', () => {
  it('round-trips to and from the date field text', () => {
    expect(dateToInput(20_260_305 as never)).toBe('2026-03-05');
    expect(inputToDate('2026-03-05')).toBe(20_260_305);
    expect(inputToDate('2026-02-30')).toBeUndefined();
    expect(inputToDate('26-3-5')).toBeUndefined();
    expect(dateToInput(10_101 as never)).toBe('0001-01-01');
  });

  it('knows today without a time zone', () => {
    expect(todayLocal(new Date(2026, 2, 5, 23, 59))).toBe(20_260_305);
    expect(todayLocal(new Date(2026, 11, 31, 0, 0))).toBe(20_261_231);
  });

  it('prints a date in the user\'s language from the civil date alone', () => {
    expect(formatDate(20_260_305 as never, 'en')).toBe('Mar 5, 2026');
    expect(formatDate(20_260_229 as never, 'en')).toBe('Mar 1, 2026'); // a non-date input rolls over rather than crashing
  });
});

describe('entry time', () => {
  it('reads wall-clock text in the offset it was entered in', () => {
    expect(inputToMoment('2026-03-05T12:00', 0)).toBe(Date.UTC(2026, 2, 5, 12));
    expect(inputToMoment('2026-03-05T12:00', 120)).toBe(Date.UTC(2026, 2, 5, 10));
    expect(inputToMoment('2026-03-05T12:00', -300)).toBe(Date.UTC(2026, 2, 5, 17));
  });

  it('shows an old entry as the wall-clock time it was made at, whatever zone this device is in now', () => {
    const utc = Date.UTC(2026, 2, 5, 23, 30);
    expect(momentToInput(utc, 120)).toBe('2026-03-06T01:30');
    expect(inputToMoment(momentToInput(utc, 120), 120)).toBe(utc);
    expect(momentToInput(utc, -420)).toBe('2026-03-05T16:30');
  });

  it('rejects text that is not a date and time', () => {
    for (const bad of ['', '2026-03-05', '2026-13-05T10:00', '2026-03-05T25:00', '2026-03-05T10:61', 'x']) expect(inputToMoment(bad, 0), bad).toBeUndefined();
  });

  it('writes the current time in the field format and finds the device offset for a wall-clock time', () => {
    expect(nowInput(new Date(2026, 2, 5, 9, 7))).toBe('2026-03-05T09:07');
    const offset = deviceOffsetAt('2026-03-05T12:00');
    expect(Number.isInteger(offset)).toBe(true);
    expect(offset).toBe(-new Date(2026, 2, 5, 12, 0).getTimezoneOffset());
    expect(Number.isInteger(deviceOffsetAt('nonsense'))).toBe(true);
  });
});

describe('rate dates', () => {
  it('turns a civil day into the second it starts at, and back', () => {
    expect(startOfDayUtcS(20_260_305 as never)).toBe(Date.UTC(2026, 2, 5) / 1000);
    expect(dateOfUtcSeconds(startOfDayUtcS(20_260_305 as never))).toBe(20_260_305);
    expect(dateOfUtcSeconds(startOfDayUtcS(20_260_305 as never) + 86_399)).toBe(20_260_305);
    expect(dateOfUtcSeconds(startOfDayUtcS(20_260_305 as never) + 86_400)).toBe(20_260_306);
  });
});

describe('the start of a day in the device time zone (rates)', () => {
  const zones = ['UTC', 'Europe/Helsinki', 'America/New_York', 'Pacific/Auckland', 'Asia/Kolkata', 'America/St_Johns'];
  it('is the instant the day begins there: the day is found from it, and the moment before belongs to the day before', () => {
    const was = process.env['TZ'];
    try {
      for (const tz of zones) {
        process.env['TZ'] = tz;
        for (const day of [20_260_120, 20_260_320, 20_261_020, 20_261_231] as const) {
          const start = startOfLocalDayUtcS(day as never);
          expect(localDateOfUtcSeconds(start), `${tz} ${day}`).toBe(day);
          expect(localDateOfUtcSeconds(start - 1), `${tz} ${day} - 1 s`).toBeLessThan(day);
          expect(localDateOfUtcSeconds(start + 12 * 3600), `${tz} ${day} noon`).toBe(day);
        }
      }
    } finally {
      if (was === undefined) delete process.env['TZ'];
      else process.env['TZ'] = was;
    }
  });

  it('is already past at the first moment of the day, where midnight UTC may not be (east of Greenwich)', () => {
    const was = process.env['TZ'];
    try {
      process.env['TZ'] = 'Europe/Helsinki';
      const firstMinute = new Date(2026, 9, 20, 0, 30).getTime() / 1000; // 00:30 on the 20th, Helsinki
      expect(startOfLocalDayUtcS(20_261_020 as never)).toBeLessThanOrEqual(firstMinute);
      expect(startOfDayUtcS(20_261_020 as never)).toBeGreaterThan(firstMinute); // the old way: still in the future
    } finally {
      if (was === undefined) delete process.env['TZ'];
      else process.env['TZ'] = was;
    }
  });
});
