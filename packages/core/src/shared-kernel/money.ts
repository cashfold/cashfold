import type { CurrencyCode } from './currency.js';
import { err, ok, type DomainError, type Result } from './result.js';

export const MAX_MINOR = 2n ** 63n - 1n;
export const MIN_MINOR = -(2n ** 63n);

export type MoneyError = DomainError<'out_of_range' | 'currency_mismatch'>;

/** Signed 64-bit count of minor units of one currency. Never a JavaScript number. */
export interface Money {
  readonly minor: bigint;
  readonly currency: CurrencyCode;
}

export function money(minor: bigint, currency: CurrencyCode): Result<Money, MoneyError> {
  if (minor > MAX_MINOR || minor < MIN_MINOR) return err('out_of_range', 'Amount is outside the supported range');
  return ok({ minor, currency });
}

function combine(a: Money, b: Money, op: (x: bigint, y: bigint) => bigint): Result<Money, MoneyError> {
  if (a.currency !== b.currency) return err('currency_mismatch', 'Amounts are in different currencies');
  return money(op(a.minor, b.minor), a.currency);
}

export const add = (a: Money, b: Money): Result<Money, MoneyError> => combine(a, b, (x, y) => x + y);
export const subtract = (a: Money, b: Money): Result<Money, MoneyError> => combine(a, b, (x, y) => x - y);
export const negate = (a: Money): Result<Money, MoneyError> => money(-a.minor, a.currency);

/** `n / d` rounded to the nearest integer, ties to the even neighbour. Exact; a single division. */
export function divRoundHalfEven(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError('division by zero');
  const num = d < 0n ? -n : n;
  const den = d < 0n ? -d : d;
  let q = num / den; // truncates toward zero
  const r = num % den;
  const twiceRemainder = (r < 0n ? -r : r) * 2n;
  if (twiceRemainder > den || (twiceRemainder === den && q % 2n !== 0n)) q += num < 0n ? -1n : 1n;
  return q;
}
