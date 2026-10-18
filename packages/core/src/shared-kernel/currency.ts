import { CURRENCY_EXPONENTS } from './currency-table.js';
import { err, ok, type DomainError, type Result } from './result.js';

declare const currencyBrand: unique symbol;
/** A currency code that is present in the exponent table. */
export type CurrencyCode = string & { readonly [currencyBrand]: true };

export function parseCurrency(code: string): Result<CurrencyCode, DomainError<'unknown_currency'>> {
  if (!/^[A-Z]{3}$/.test(code) || !Object.hasOwn(CURRENCY_EXPONENTS, code)) {
    return err('unknown_currency', 'Unsupported currency code');
  }
  return ok(code as CurrencyCode);
}

/** Number of minor-unit decimal digits (0..8). */
export function exponentOf(code: CurrencyCode): number {
  const exponent = CURRENCY_EXPONENTS[code];
  if (exponent === undefined) throw new Error('unreachable: CurrencyCode is validated');
  return exponent;
}
