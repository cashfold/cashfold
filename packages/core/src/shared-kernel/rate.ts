import { err, ok, type DomainError, type Result } from './result.js';

declare const rateBrand: unique symbol;
/** `rate_e12`: units of the quote currency per 1 USD, scaled by 10^12. Always in (0, 2^63-1]. */
export type Rate = bigint & { readonly [rateBrand]: true };

export const RATE_SCALE = 10n ** 12n;
const MAX_RATE = 2n ** 63n - 1n;

export function rate(e12: bigint): Result<Rate, DomainError<'invalid_rate'>> {
  if (e12 <= 0n || e12 > MAX_RATE) return err('invalid_rate', 'Rate must be greater than zero and fit in 64 bits');
  return ok(e12 as Rate);
}

/** USD is the pivot currency: one USD is one USD. */
export const PIVOT_RATE = RATE_SCALE as Rate;
