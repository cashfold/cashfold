import { localDate, type LocalDate } from '@cashfold/core';

// Dates and times as the ledger stores them: a UTC instant plus the offset it was entered in, and the civil date
// derived from both. The form fields use the browser's `datetime-local` text so no time zone is guessed twice.

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Whole-number division that rounds down, for dates (the maths library is kept out of money code). */
const div = (n: number, d: number): number => (n - (n % d)) / d;
const yearOfDate = (d: LocalDate): number => div(d, 10_000);
const monthOfDate = (d: LocalDate): number => div(d, 100) % 100;

/** Today's civil date on this device. */
export function todayLocal(now: Date = new Date()): LocalDate {
  const r = localDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  if (!r.ok) throw new RangeError('device date out of range');
  return r.value;
}

export const dateToInput = (d: LocalDate): string => `${pad(yearOfDate(d), 4)}-${pad(monthOfDate(d))}-${pad(d % 100)}`;

export function inputToDate(text: string): LocalDate | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m === null) return undefined;
  const r = localDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return r.ok ? r.value : undefined;
}

/** `YYYY-MM-DDTHH:mm` for a `datetime-local` field showing the device's current time. */
export function nowInput(now: Date = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** The wall-clock text of an instant in the offset it was entered in, so an old entry shows the day it was made on. */
export function momentToInput(utcMs: number, tzOffsetMin: number): string {
  const d = new Date(utcMs + tzOffsetMin * 60_000);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** An instant from `datetime-local` text read in a given offset (minutes east of UTC). */
export function inputToMoment(text: string, tzOffsetMin: number): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (m === null || !localDate(Number(m[1]), Number(m[2]), Number(m[3])).ok) return undefined;
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (hour > 23 || minute > 59) return undefined;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute) - tzOffsetMin * 60_000;
}

/** The offset this device is in at the entered wall-clock time (daylight saving included), minutes east of UTC. */
export function deviceOffsetAt(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (m === null) return -new Date().getTimezoneOffset();
  return -new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTimezoneOffset();
}

/** "15 Mar 2026" in the user's language, from the civil date alone (no time zone involved). */
export function formatDate(d: LocalDate, locale: string): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(Date.UTC(yearOfDate(d), monthOfDate(d) - 1, d % 100)));
}

export function formatDateTime(utcMs: number, locale: string): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(utcMs));
}
