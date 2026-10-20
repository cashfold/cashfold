import { describe, expect, it } from 'vitest';
import { validateExchangeRate, type ExchangeRate, type Id } from '@cashfold/core';
import { suggestDestination } from './suggest';

const rate = (n: string, quote: string, asOfUtcS: number, rateE12: bigint): ExchangeRate => {
  const r = validateExchangeRate({ quote, asOfUtcS, rateE12, source: 'custom' });
  if (!r.ok) throw new Error('fixture');
  return { id: n as Id, ...r.value };
};
const RATES = [rate('eur', 'EUR', 100, 913_700_000_000n), rate('jpy', 'JPY', 100, 150_000_000_000_000n)];

describe('suggestDestination', () => {
  it('works out the destination from the rate, exactly', () => {
    expect(suggestDestination(10_000n, 'USD', 'EUR', RATES, 200)).toEqual({ toMinor: 9_137n, rateId: 'eur' });
  });

  it('goes the other way and across two non-USD currencies', () => {
    expect(suggestDestination(9_137n, 'EUR', 'USD', RATES, 200)).toEqual({ toMinor: 10_000n, rateId: 'eur' });
    expect(suggestDestination(1_000n, 'EUR', 'JPY', RATES, 200)?.toMinor).toBeTypeOf('bigint');
  });

  it('suggests nothing for one currency, an unknown rate, or a time before the first rate', () => {
    expect(suggestDestination(100n, 'USD', 'USD', RATES, 200)).toBeUndefined();
    expect(suggestDestination(100n, 'USD', 'GBP', RATES, 200)).toBeUndefined();
    expect(suggestDestination(100n, 'USD', 'EUR', RATES, 50)).toBeUndefined();
    expect(suggestDestination(100n, 'USD', 'ZZZ', RATES, 200)).toBeUndefined();
  });

  it('does not overflow quietly', () => {
    expect(suggestDestination(2n ** 63n - 1n, 'USD', 'JPY', RATES, 200)).toBeUndefined();
  });
});
