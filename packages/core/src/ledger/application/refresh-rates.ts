import type { Id } from '../../shared-kernel/id';
import { rate, RATE_SCALE } from '../../shared-kernel/rate';
import { ok, type DomainError } from '../../shared-kernel/result';
import type { CommandDef } from '../../sync/application/buses';
import { createRateCommands } from './rate-commands';

/** A table as the user's own service publishes it (`GET /rates`): decimal text per currency, units of that currency per USD. */
export interface PublishedRates {
  readonly base: string;
  /** ISO 8601 instant the rates are valid for. */
  readonly asOf: string;
  readonly source: string;
  readonly rates: Readonly<Record<string, string>>;
}

export type RatesFetch = { readonly ok: true; readonly table: PublishedRates } | { readonly ok: false; readonly reason: 'offline' | 'not_published' | 'invalid' };

/** Reads the rate table from the user's configured service and from nowhere else (FR-103). */
export interface RatesSourcePort {
  fetch(): Promise<RatesFetch>;
}

const DECIMAL = /^(\d+)(?:\.(\d{1,18}))?$/;
const FRACTION_DIGITS = 12;

/**
 * Decimal text to a rate scaled by 10^12, by integer arithmetic only. Digits beyond the twelfth round half to even.
 * Zero, negatives, exponents and anything that does not fit in 63 bits are refused.
 */
export function parseRateText(text: string): bigint | undefined {
  const m = DECIMAL.exec(text);
  if (m === null) return undefined;
  const whole = BigInt(m[1]!);
  const frac = m[2] ?? '';
  const kept = BigInt((frac.slice(0, FRACTION_DIGITS) + '0'.repeat(FRACTION_DIGITS)).slice(0, FRACTION_DIGITS));
  let scaled = whole * RATE_SCALE + kept;
  const rest = frac.slice(FRACTION_DIGITS);
  if (rest.length > 0) {
    const restN = BigInt(rest);
    const half = 5n * 10n ** BigInt(rest.length - 1);
    if (restN > half || (restN === half && scaled % 2n === 1n)) scaled += 1n;
  }
  const valid = rate(scaled);
  return valid.ok ? valid.value : undefined;
}

export type RefreshOutcome =
  | { readonly status: 'updated'; readonly stored: number; readonly skipped: number; readonly asOfUtcS: number }
  | { readonly status: 'unavailable'; readonly reason: 'offline' | 'not_published' | 'invalid' };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function createRefreshRates(deps: { source: RatesSourcePort }) {
  const { applyRateTable } = createRateCommands();
  const refreshRates: CommandDef<{ fold: Id }, RefreshOutcome, DomainError> = {
    name: 'refreshRates',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      // With no service to ask, or none that answers, the last stored rates stay in force: this is not a failure.
      let fetched;
      try {
        fetched = await deps.source.fetch();
      } catch {
        return ok({ status: 'unavailable', reason: 'offline' } as const);
      }
      if (!fetched.ok) return ok({ status: 'unavailable', reason: fetched.reason } as const);
      const { table } = fetched;
      const asOfMs = ISO.test(table.asOf) ? Date.parse(table.asOf) : Number.NaN;
      if (table.base !== 'USD' || !Number.isFinite(asOfMs)) return ok({ status: 'unavailable', reason: 'invalid' } as const);
      const asOfUtcS = Number(BigInt(asOfMs) / 1000n);

      const rates: { quote: string; rateE12: bigint }[] = [];
      let unusable = 0;
      for (const [quote, text] of Object.entries(table.rates)) {
        const rateE12 = parseRateText(text);
        if (rateE12 === undefined) unusable += 1;
        else rates.push({ quote, rateE12 });
      }
      const applied = await applyRateTable.handle({ fold: c.fold, asOfUtcS, rates }, ctx);
      if (!applied.ok) return applied;
      return ok({ status: 'updated', stored: applied.value.stored, skipped: applied.value.skipped + unusable, asOfUtcS } as const);
    },
  };
  return refreshRates;
}
