import { parseCurrency, type CurrencyCode } from '../../shared-kernel/currency';
import type { Id } from '../../shared-kernel/id';
import { rate, type Rate } from '../../shared-kernel/rate';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { FieldValue } from '../../sync/domain/merge';
import { RATE_FIELD } from './tables';

/** All rates are units of the quote currency per one USD (the pivot), scaled by 10^12 (FR-040, FR-042). */
export const PIVOT_CURRENCY = 'USD';

export type RateSource = 'service' | 'custom';

export interface NewExchangeRate {
  readonly quote: CurrencyCode;
  readonly asOfUtcS: number;
  readonly rateE12: Rate;
  readonly source: RateSource;
}

export interface ExchangeRate extends NewExchangeRate {
  readonly id: Id;
}

export type ExchangeRateError = DomainError<'invalid_rate' | 'unknown_currency' | 'invalid_quote' | 'invalid_source' | 'invalid_as_of'>;

export function validateExchangeRate(input: { quote: string; asOfUtcS: number; rateE12: bigint; source: string }): Result<NewExchangeRate, ExchangeRateError> {
  const quote = parseCurrency(input.quote);
  if (!quote.ok) return quote;
  if (quote.value === PIVOT_CURRENCY) return err('invalid_quote', 'The USD pivot has no rate of its own');
  if (input.source !== 'service' && input.source !== 'custom') return err('invalid_source', 'A rate comes from the service or is custom');
  if (!Number.isSafeInteger(input.asOfUtcS) || input.asOfUtcS < 0) return err('invalid_as_of', 'The rate date is not valid');
  const value = rate(input.rateE12);
  if (!value.ok) return value;
  return ok({ quote: quote.value, asOfUtcS: input.asOfUtcS, rateE12: value.value, source: input.source });
}

export const rateKey = (quote: string, asOfUtcS: number): string => `${quote}@${asOfUtcS}`;

/** The rate in force at `asOfUtcS`: the latest one dated at or before it. Independent of input order. */
export function nearestPrior(rates: readonly ExchangeRate[], quote: string, asOfUtcS: number): ExchangeRate | undefined {
  let best: ExchangeRate | undefined;
  for (const r of rates) {
    if (r.quote !== quote || r.asOfUtcS > asOfUtcS) continue;
    if (best === undefined || r.asOfUtcS > best.asOfUtcS || (r.asOfUtcS === best.asOfUtcS && beats(r, best))) best = r;
  }
  return best;
}

const rank = (r: ExchangeRate): number => (r.source === 'custom' ? 0 : 1);
/** Total order used when two rates share `(quote, as_of)`: custom first, then the lower id. */
const beats = (a: ExchangeRate, b: ExchangeRate): boolean => rank(a) < rank(b) || (rank(a) === rank(b) && a.id < b.id);

export interface ResolvedRates {
  readonly rates: readonly ExchangeRate[];
  /** Losers of a `(quote, as_of)` clash: shown in Needs attention, never used. */
  readonly duplicates: readonly ExchangeRate[];
}

export function resolveRates(all: readonly ExchangeRate[]): ResolvedRates {
  const winners = new Map<string, ExchangeRate>();
  const duplicates: ExchangeRate[] = [];
  for (const r of all) {
    const key = rateKey(r.quote, r.asOfUtcS);
    const current = winners.get(key);
    if (current === undefined) winners.set(key, r);
    else if (beats(r, current)) {
      duplicates.push(current);
      winners.set(key, r);
    } else duplicates.push(r);
  }
  return { rates: [...winners.values()].sort((a, b) => a.asOfUtcS - b.asOfUtcS || (a.quote < b.quote ? -1 : 1)), duplicates };
}

export function exchangeRateFieldPatch(r: NewExchangeRate): Map<number, FieldValue> {
  return new Map<number, FieldValue>([
    [RATE_FIELD.quote, r.quote],
    [RATE_FIELD.asOfUtcS, BigInt(r.asOfUtcS)],
    [RATE_FIELD.rateE12, r.rateE12],
    [RATE_FIELD.source, r.source],
  ]);
}
