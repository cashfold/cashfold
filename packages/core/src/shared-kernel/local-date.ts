import { err, ok, type DomainError, type Result } from './result.js';

declare const localDateBrand: unique symbol;
/** Civil calendar date stored as the integer yyyymmdd. No time zone, no time of day. */
export type LocalDate = number & { readonly [localDateBrand]: true };

const MS_PER_DAY = 86_400_000;
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

export const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

export function localDate(y: number, m: number, d: number): Result<LocalDate, DomainError<'invalid_date'>> {
  const valid =
    Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
    y >= MIN_YEAR && y <= MAX_YEAR && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  return valid ? ok((y * 10_000 + m * 100 + d) as LocalDate) : err('invalid_date', 'Not a valid calendar date');
}

export const yearOf = (v: LocalDate): number => Math.floor(v / 10_000);
export const monthOf = (v: LocalDate): number => Math.floor(v / 100) % 100;
export const dayOf = (v: LocalDate): number => v % 100;

// Days since 1970-01-01 <-> civil date (H. Hinnant's algorithms, proleptic Gregorian).
function toEpochDays(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

function fromEpochDays(days: number): LocalDate {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  const r = localDate(y, m, d);
  if (!r.ok) throw new RangeError('date out of supported range');
  return r.value;
}

const epochDaysOf = (v: LocalDate): number => toEpochDays(yearOf(v), monthOf(v), dayOf(v));

export const addDays = (v: LocalDate, n: number): LocalDate => fromEpochDays(epochDaysOf(v) + n);

/** Adds calendar months, clamping the day to the end of shorter months (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(v: LocalDate, n: number): LocalDate {
  const total = yearOf(v) * 12 + (monthOf(v) - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12 + 12) % 12 + 1;
  const r = localDate(y, m, Math.min(dayOf(v), daysInMonth(y, m)));
  if (!r.ok) throw new RangeError('date out of supported range');
  return r.value;
}

export const daysBetween = (from: LocalDate, to: LocalDate): number => epochDaysOf(to) - epochDaysOf(from);

export const compare = (a: LocalDate, b: LocalDate): number => a - b;

/** The civil date a `(utc_ms, tz_offset_min)` instant falls on in its own offset. */
export const fromEpochMs = (utcMs: number, tzOffsetMin: number): LocalDate =>
  fromEpochDays(Math.floor((utcMs + tzOffsetMin * 60_000) / MS_PER_DAY));
