import type { CurrencyCode } from '../../shared-kernel/currency';
import { convert } from '../../shared-kernel/fx';
import type { Id } from '../../shared-kernel/id';
import type { Money } from '../../shared-kernel/money';
import { PIVOT_RATE, type Rate } from '../../shared-kernel/rate';
import { err, ok, type Result } from '../../shared-kernel/result';
import { nearestPrior, PIVOT_CURRENCY, type ExchangeRate } from '../domain/exchange-rate';

export interface BaseSnapshot {
  readonly baseAmountMinor: bigint;
  readonly baseCurrency: CurrencyCode;
  /** The rate of the transaction currency that was used, or null when it is USD or the base currency. */
  readonly fxRateId: Id | null;
  /** The rate of the base currency that was used, or null when it is USD or the transaction currency. */
  readonly fxBaseRateId: Id | null;
}

export type SnapshotError =
  | { readonly code: 'rate_required'; readonly message: string; readonly currency: string }
  | { readonly code: 'out_of_range'; readonly message: string };

interface Leg {
  readonly rate: Rate;
  readonly id: Id | null;
}

function legFor(currency: CurrencyCode, rates: readonly ExchangeRate[], asOfUtcS: number): Leg | undefined {
  if (currency === PIVOT_CURRENCY) return { rate: PIVOT_RATE, id: null };
  const found = nearestPrior(rates, currency, asOfUtcS);
  return found === undefined ? undefined : { rate: found.rateE12, id: found.id };
}

/**
 * The base-currency equivalent of an amount, frozen at entry (FR-041): the nearest rate dated at or before
 * `asOfUtcS` for each currency, one bigint division, one half-even rounding (FR-040). With no usable rate it
 * refuses rather than guess; the user can then enter a custom rate (FR-042).
 */
export function snapshotBase(input: { amount: Money; baseCurrency: CurrencyCode; rates: readonly ExchangeRate[]; asOfUtcS: number }): Result<BaseSnapshot, SnapshotError> {
  const { amount, baseCurrency, rates, asOfUtcS } = input;
  if (amount.currency === baseCurrency) {
    return ok({ baseAmountMinor: amount.minor, baseCurrency, fxRateId: null, fxBaseRateId: null });
  }
  const from = legFor(amount.currency, rates, asOfUtcS);
  if (from === undefined) return { ok: false, error: { code: 'rate_required', message: 'No exchange rate is known for this currency', currency: amount.currency } };
  const to = legFor(baseCurrency, rates, asOfUtcS);
  if (to === undefined) return { ok: false, error: { code: 'rate_required', message: 'No exchange rate is known for the base currency', currency: baseCurrency } };
  const converted = convert(amount, baseCurrency, from.rate, to.rate);
  if (!converted.ok) return err('out_of_range', 'The converted amount is outside the supported range');
  return ok({ baseAmountMinor: converted.value.minor, baseCurrency, fxRateId: from.id, fxBaseRateId: to.id });
}
