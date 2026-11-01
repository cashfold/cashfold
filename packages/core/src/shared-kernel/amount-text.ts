import { exponentOf, type CurrencyCode } from './currency';
import { money, type Money, type MoneyError } from './money';
import { err, type DomainError, type Result } from './result';

export interface Separators {
  readonly decimal: string;
  readonly group: string;
}

export type AmountTextError = DomainError<'invalid_format' | 'too_many_decimals' | 'division_by_zero'> | MoneyError;

const DIGITS = /^\d+$/;
const invalid = (): Result<never, AmountTextError> => err('invalid_format', 'Not a valid amount');

/**
 * Reads the digits of one unsigned number written with the language's marks: whole digits (with well-formed groups) and the digits after the
 * decimal mark. `undefined` when the text is not such a number. Shared by `parseAmountText` and the sums in `amount-expression.ts`, so a number
 * inside a sum is read exactly as a plain number is.
 */
export function readDecimal(body: string, sep: Separators): { readonly intDigits: string; readonly frac: string } | undefined {
  const parts = body.split(sep.decimal);
  if (parts.length > 2) return undefined;
  const intText = parts[0] ?? '';
  const fracText = parts[1];
  if (fracText !== undefined && !DIGITS.test(fracText)) return undefined;

  let intDigits = intText;
  if (intText.includes(sep.group)) {
    const groups = intText.split(sep.group);
    const [first = '', ...rest] = groups;
    const wellFormed = /^\d{1,3}$/.test(first) && rest.every((g) => /^\d{3}$/.test(g));
    if (!wellFormed) return undefined;
    intDigits = groups.join('');
  } else if (intText !== '' && !DIGITS.test(intText)) {
    return undefined;
  }
  if (intDigits === '' && fracText === undefined) return undefined;
  return { intDigits, frac: fracText ?? '' };
}

/** Parses user-entered decimal text exactly; never rounds and never goes through floating point. */
export function parseAmountText(text: string, currency: CurrencyCode, sep: Separators): Result<Money, AmountTextError> {
  let body = text.trim();
  let negative = false;
  if (body.startsWith('-') || body.startsWith('+')) {
    negative = body.startsWith('-');
    body = body.slice(1);
  }

  const read = readDecimal(body, sep);
  if (read === undefined) return invalid();
  const { intDigits, frac } = read;

  const exponent = exponentOf(currency);
  if (frac.length > exponent) return err('too_many_decimals', 'Too many decimal places for this currency');

  const magnitude = BigInt(intDigits === '' ? '0' : intDigits) * 10n ** BigInt(exponent) + BigInt(frac.padEnd(exponent, '0') || '0');
  return money(negative ? -magnitude : magnitude, currency);
}

export function formatAmount(value: Money, sep: Separators): string {
  const exponent = exponentOf(value.currency);
  const abs = value.minor < 0n ? -value.minor : value.minor;
  const digits = abs.toString().padStart(exponent + 1, '0');
  const intPart = digits.slice(0, digits.length - exponent).replace(/\B(?=(\d{3})+(?!\d))/g, sep.group);
  const fracPart = digits.slice(digits.length - exponent);
  return `${value.minor < 0n ? '-' : ''}${intPart}${exponent > 0 ? sep.decimal + fracPart : ''}`;
}
