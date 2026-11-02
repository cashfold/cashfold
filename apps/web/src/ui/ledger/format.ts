import { exponentOf, formatAmount, isAmountExpression, parseAmountText, parseCurrency, type AmountTextError, type DomainError, type Result } from '@cashfold/core';
import { separatorsFor } from '../i18n/i18n';

// Exact money text in and out. Amounts are bigint minor units everywhere; text is parsed and printed with the
// currency's own number of decimals and the locale's separators, never through floating point (FR-037).

export type Sign = 'gain' | 'loss' | 'zero';

export const signOf = (minor: bigint): Sign => (minor > 0n ? 'gain' : minor < 0n ? 'loss' : 'zero');

/** "1,234.50 USD", "−1,234.50 USD". The sign is part of the text, so colour is never the only cue. */
export function formatMoney(minor: bigint, currency: string, locale: string): string {
  const parsed = parseCurrency(currency);
  if (!parsed.ok) return `${minor} ${currency}`;
  const text = formatAmount({ minor, currency: parsed.value }, separatorsFor(locale));
  return `${text.startsWith('-') ? `−${text.slice(1)}` : text} ${currency}`;
}

/** The same, with an explicit + for gains, for lists where direction matters. */
export const formatSigned = (minor: bigint, currency: string, locale: string): string => (minor > 0n ? `+${formatMoney(minor, currency, locale)}` : formatMoney(minor, currency, locale));

/** Digits only, no currency: what an amount field shows when editing. */
export function formatPlain(minor: bigint, currency: string, locale: string): string {
  return formatMoney(minor, currency, locale).replace(/ [A-Z]{3}$/, '').replace('−', '-');
}

/** Exact parse of what a person typed. */
export type MoneyTextError = AmountTextError | DomainError<'unknown_currency'>;

/**
 * What a person types is not always what the locale prints. Where the thousands mark is a space (Polish, Ukrainian) people type an ordinary
 * space, a no-break space or a narrow one; where the decimal mark is a comma they often type a dot. Both are read as the locale's own marks,
 * but only when that cannot be ambiguous: an entry that already contains the decimal mark, or a dot where the locale uses dots for thousands,
 * is left alone and the exact parser decides. Nothing here touches digits, so the result is still exact.
 */
export function normalizeAmountText(text: string, locale: string): string {
  const { decimal, group } = separatorsFor(locale);
  let out = text.trim();
  if (/^\s$/u.test(group)) out = out.replace(/[\s\u00A0\u202F]+/gu, group);
  if (decimal === ',' && group !== '.' && !out.includes(',') && out.split('.').length === 2) out = out.replace('.', decimal);
  return out;
}

type EvaluateAmount = typeof import('@cashfold/core/amount-expression').evaluateAmount;
let evaluate: EvaluateAmount | undefined;

/**
 * Loads the sum evaluator, which is its own small chunk so the screens that never see a sum do not carry it (spec 020). The ledger asks for it as soon as
 * it is in use, well before a person can type a sum; until it is there a sum cannot be worked out and reads as "not ready".
 */
export async function loadAmountExpression(): Promise<void> {
  if (evaluate === undefined) evaluate = (await import('@cashfold/core/amount-expression')).evaluateAmount;
}
export const amountExpressionLoaded = (): boolean => evaluate !== undefined;

export function parseMoney(text: string, currency: string, locale: string): Result<bigint, MoneyTextError> {
  const code = parseCurrency(currency);
  if (!code.ok) return code;
  // A sum ("12.50 + 3.20 * 2") is worked out exactly and rounded once at the end (spec 020); the evaluator applies the typing leniency to each number
  // itself. Anything else is a plain amount and keeps the old rules, including "too many decimals" being an error.
  if (isAmountExpression(text) && evaluate === undefined) return { ok: false, error: { code: 'invalid_format', message: 'Sums are not ready yet' } };
  const r = isAmountExpression(text) && evaluate !== undefined
    ? evaluate(text, code.value, separatorsFor(locale))
    : parseAmountText(normalizeAmountText(text, locale), code.value, separatorsFor(locale));
  return r.ok ? { ok: true, value: r.value.minor } : r;
}

export const decimalsOf = (currency: string): number => {
  const code = parseCurrency(currency);
  return code.ok ? exponentOf(code.value) : 2;
};

const STORED_DECIMALS = 12;
export type RateTextError = { code: 'invalid_rate_text'; message: string } | { code: 'too_precise'; message: string };

/** A rate typed as "0.9215" (units of the quote currency per 1 USD) to its exact 10^-12 integer. */
export function parseRateText(text: string, locale: string): Result<bigint, RateTextError> {
  const { decimal, group } = separatorsFor(locale);
  const cleaned = text.trim().replaceAll(group, '');
  const parts = cleaned.split(decimal);
  const [whole = '', frac = ''] = parts;
  if (parts.length > 2 || !/^\d+$/.test(whole === '' ? '0' : whole) || (frac !== '' && !/^\d+$/.test(frac)) || cleaned === '') {
    return { ok: false, error: { code: 'invalid_rate_text', message: 'Not a valid rate' } };
  }
  if (frac.length > STORED_DECIMALS) return { ok: false, error: { code: 'too_precise', message: 'Too many decimal places' } };
  return { ok: true, value: BigInt(whole === '' ? '0' : whole) * 10n ** BigInt(STORED_DECIMALS) + BigInt(frac.padEnd(STORED_DECIMALS, '0') || '0') };
}

/** A share of a total as whole percent (0 to 100) for drawing bars. Display only; money stays bigint. */
export function percentOf(part: bigint, whole: bigint): number {
  if (whole <= 0n || part <= 0n) return 0;
  const p = (part * 100n) / whole;
  return Number(p > 100n ? 100n : p);
}

const DEGREE_DECIMALS = 7;
export type DegreesError = { code: 'invalid_degrees'; message: string } | { code: 'too_precise'; message: string } | { code: 'out_of_bounds'; message: string };

/** A latitude or longitude typed as decimal degrees to its exact 10^-7 integer, within +/- `limit` degrees. */
export function parseDegrees(text: string, locale: string, limit: number): Result<number, DegreesError> {
  const { decimal } = separatorsFor(locale);
  const body = text.trim().replace(/^\+/, '');
  const negative = body.startsWith('-');
  const parts = (negative ? body.slice(1) : body).split(decimal);
  const [whole = '', frac = ''] = parts;
  if (parts.length > 2 || !/^\d+$/.test(whole) || (frac !== '' && !/^\d+$/.test(frac))) {
    return { ok: false, error: { code: 'invalid_degrees', message: 'Not a valid coordinate' } };
  }
  if (frac.length > DEGREE_DECIMALS) return { ok: false, error: { code: 'too_precise', message: 'Too many decimal places' } };
  const e7 = BigInt(whole) * 10n ** BigInt(DEGREE_DECIMALS) + BigInt(frac.padEnd(DEGREE_DECIMALS, '0') || '0');
  if (e7 > BigInt(limit) * 10n ** BigInt(DEGREE_DECIMALS)) return { ok: false, error: { code: 'out_of_bounds', message: 'Outside the valid range' } };
  return { ok: true, value: Number(negative ? -e7 : e7) };
}

/** Degrees stored as a 10^-7 integer, shown with the decimals that matter. */
export function formatDegrees(e7: number, locale: string): string {
  const { decimal } = separatorsFor(locale);
  const big = BigInt(e7);
  const abs = big < 0n ? -big : big;
  const digits = abs.toString().padStart(DEGREE_DECIMALS + 1, '0');
  const frac = digits.slice(-DEGREE_DECIMALS).replace(/0+$/, '');
  return `${big < 0n ? '-' : ''}${digits.slice(0, -DEGREE_DECIMALS)}${frac === '' ? '' : decimal + frac}`;
}

/** A coordinate from the device's location service (a float) as the 10^-7 integer we store, rounded by text, not arithmetic. */
export function degreesFromDevice(value: number): number {
  const fixed = new Intl.NumberFormat('en-US', { minimumFractionDigits: DEGREE_DECIMALS, maximumFractionDigits: DEGREE_DECIMALS, useGrouping: false }).format(value);
  return Number(fixed.replace('.', '').replace(/^(-?)0+(?=\d)/, '$1'));
}

/** A rate (10^-12 units) as text, with only the decimals that matter: 921500000000 -> "0.9215". */
export function formatRate(e12: bigint, locale: string): string {
  const { decimal } = separatorsFor(locale);
  const digits = e12.toString().padStart(STORED_DECIMALS + 1, '0');
  const frac = digits.slice(-STORED_DECIMALS).replace(/0+$/, '');
  return `${digits.slice(0, -STORED_DECIMALS)}${frac === '' ? '' : decimal + frac}`;
}
