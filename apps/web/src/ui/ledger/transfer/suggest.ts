import { convert, nearestPrior, parseCurrency, PIVOT_RATE, PIVOT_CURRENCY, type ExchangeRate, type Id } from '@cashfold/core';

export interface Suggestion {
  /** The destination amount the known rates give, to the smallest unit, rounded half to even once. */
  readonly toMinor: bigint;
  /** The rate record(s) it came from, so the transfer can say what it was based on. */
  readonly rateId: Id | null;
}

/**
 * What the known rates would make the destination amount, for a "suggest" button. It only ever fills a field when
 * asked: an amount the person typed is never replaced by a computed one (FR-044). Undefined when a rate is missing.
 */
export function suggestDestination(fromMinor: bigint, fromCurrency: string, toCurrency: string, rates: readonly ExchangeRate[], atUtcS: number): Suggestion | undefined {
  const [from, to] = [parseCurrency(fromCurrency), parseCurrency(toCurrency)];
  if (!from.ok || !to.ok || from.value === to.value) return undefined;
  const leg = (code: string) => (code === PIVOT_CURRENCY ? { rate: PIVOT_RATE, id: null } : ((r) => (r === undefined ? undefined : { rate: r.rateE12, id: r.id }))(nearestPrior(rates, code, atUtcS)));
  const [a, b] = [leg(from.value), leg(to.value)];
  if (a === undefined || b === undefined) return undefined;
  const converted = convert({ minor: fromMinor, currency: from.value }, to.value, a.rate, b.rate);
  return converted.ok ? { toMinor: converted.value.minor, rateId: a.id ?? b.id } : undefined;
}
