import { exponentOf, type CurrencyCode } from './currency.js';
import { divRoundHalfEven, money, type Money, type MoneyError } from './money.js';
import type { Rate } from './rate.js';
import type { Result } from './result.js';

/**
 * Converts through the USD pivot with one bigint division and one half-even rounding (FR-040):
 *   y = round_half_even(a * 10^eY * R_Y / (10^eX * R_X))
 * `rateFrom` and `rateTo` are the `rate_e12` of the source and target currencies (PIVOT_RATE for USD).
 */
export function convert(amount: Money, to: CurrencyCode, rateFrom: Rate, rateTo: Rate): Result<Money, MoneyError> {
  const numerator = amount.minor * 10n ** BigInt(exponentOf(to)) * rateTo;
  const denominator = 10n ** BigInt(exponentOf(amount.currency)) * rateFrom;
  return money(divRoundHalfEven(numerator, denominator), to);
}
