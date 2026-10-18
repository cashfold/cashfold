import { describe, expect, it } from 'vitest';
import { id } from '../../testing/index';
import { RATE_FIELD } from './tables';
import { exchangeRateFieldPatch, nearestPrior, rateKey, resolveRates, validateExchangeRate, type ExchangeRate } from './exchange-rate';

const rate = (n: number, quote: string, asOfUtcS: number, rateE12: bigint, source: 'service' | 'custom' = 'service'): ExchangeRate => {
  const r = validateExchangeRate({ quote, asOfUtcS, rateE12, source });
  if (!r.ok) throw new Error(`fixture ${r.error.code}`);
  return { id: id(n), ...r.value };
};

describe('ExchangeRate: validation', () => {
  it('requires a rate greater than zero', () => {
    expect(validateExchangeRate({ quote: 'EUR', asOfUtcS: 1, rateE12: 0n, source: 'service' })).toMatchObject({ ok: false, error: { code: 'invalid_rate' } });
    expect(validateExchangeRate({ quote: 'EUR', asOfUtcS: 1, rateE12: -5n, source: 'service' })).toMatchObject({ ok: false, error: { code: 'invalid_rate' } });
    expect(validateExchangeRate({ quote: 'EUR', asOfUtcS: 1, rateE12: 920_000_000_000n, source: 'service' }).ok).toBe(true);
  });

  it('keeps a 64-bit rate exact and rejects larger ones', () => {
    const max = 2n ** 63n - 1n;
    const ok = validateExchangeRate({ quote: 'EUR', asOfUtcS: 1, rateE12: max, source: 'custom' });
    expect(ok.ok && ok.value.rateE12).toBe(max);
    expect(validateExchangeRate({ quote: 'EUR', asOfUtcS: 1, rateE12: max + 1n, source: 'custom' })).toMatchObject({ ok: false, error: { code: 'invalid_rate' } });
  });

  it('accepts only a known quote currency other than the USD pivot', () => {
    expect(validateExchangeRate({ quote: 'ZZZ', asOfUtcS: 1, rateE12: 1n, source: 'service' })).toMatchObject({ ok: false, error: { code: 'unknown_currency' } });
    expect(validateExchangeRate({ quote: 'USD', asOfUtcS: 1, rateE12: 1n, source: 'service' })).toMatchObject({ ok: false, error: { code: 'invalid_quote' } });
  });

  it('accepts only service or custom as the source', () => {
    expect(validateExchangeRate({ quote: 'EUR', asOfUtcS: 1, rateE12: 1n, source: 'guess' as never })).toMatchObject({ ok: false, error: { code: 'invalid_source' } });
  });

  it('requires a whole, non-negative timestamp in seconds', () => {
    expect(validateExchangeRate({ quote: 'EUR', asOfUtcS: -1, rateE12: 1n, source: 'service' })).toMatchObject({ ok: false, error: { code: 'invalid_as_of' } });
    expect(validateExchangeRate({ quote: 'EUR', asOfUtcS: 1.5, rateE12: 1n, source: 'service' })).toMatchObject({ ok: false, error: { code: 'invalid_as_of' } });
  });
});

describe('ExchangeRate: lookup', () => {
  const rates = [rate(1, 'EUR', 100, 900n), rate(2, 'EUR', 200, 910n), rate(3, 'EUR', 300, 920n), rate(4, 'GBP', 150, 780n)];

  it('finds the nearest rate at or before the requested time', () => {
    expect(nearestPrior(rates, 'EUR', 250)?.rateE12).toBe(910n);
    expect(nearestPrior(rates, 'EUR', 200)?.rateE12).toBe(910n);
    expect(nearestPrior(rates, 'EUR', 300)?.rateE12).toBe(920n);
    expect(nearestPrior(rates, 'EUR', 10_000)?.rateE12).toBe(920n);
  });

  it('finds nothing before the first rate or for an unknown quote', () => {
    expect(nearestPrior(rates, 'EUR', 99)).toBeUndefined();
    expect(nearestPrior(rates, 'JPY', 500)).toBeUndefined();
  });

  it('keeps quotes separate', () => {
    expect(nearestPrior(rates, 'GBP', 500)?.rateE12).toBe(780n);
  });

  it('does not depend on the order of the input', () => {
    expect(nearestPrior([...rates].reverse(), 'EUR', 250)?.rateE12).toBe(910n);
  });
});

describe('ExchangeRate: one rate per (quote, as_of)', () => {
  it('has a stable key', () => {
    expect(rateKey('EUR', 100)).toBe(rateKey('EUR', 100));
    expect(rateKey('EUR', 100)).not.toBe(rateKey('EUR', 101));
    expect(rateKey('EUR', 100)).not.toBe(rateKey('GBP', 100));
  });

  it('resolves a duplicate the same way on every replica: a custom rate beats a service rate, then the lower id wins', () => {
    const service = rate(5, 'EUR', 100, 900n, 'service');
    const custom = rate(9, 'EUR', 100, 905n, 'custom');
    const otherCustom = rate(7, 'EUR', 100, 906n, 'custom');
    for (const order of [[service, custom, otherCustom], [otherCustom, custom, service], [custom, service, otherCustom]]) {
      const resolved = resolveRates(order);
      expect(resolved.rates).toHaveLength(1);
      expect(resolved.rates[0]?.id).toBe(otherCustom.id);
      expect(resolved.duplicates.map((d) => d.id).sort()).toEqual([custom.id, service.id].sort());
    }
  });
});

describe('ExchangeRate: record fields', () => {
  it('writes the rate as a bigint and the source as text', () => {
    const p = exchangeRateFieldPatch({ quote: 'EUR' as never, asOfUtcS: 10, rateE12: 5n as never, source: 'custom' });
    expect(p.get(RATE_FIELD.rateE12)).toBe(5n);
    expect(p.get(RATE_FIELD.source)).toBe('custom');
    expect(p.get(RATE_FIELD.asOfUtcS)).toBe(10n);
  });
});

describe('ExchangeRate: ties', () => {
  it('prefers a custom rate when two rates share the same instant', () => {
    const service = rate(1, 'EUR', 100, 900n, 'service');
    const custom = rate(2, 'EUR', 100, 910n, 'custom');
    expect(nearestPrior([service, custom], 'EUR', 150)?.id).toBe(custom.id);
    expect(nearestPrior([custom, service], 'EUR', 150)?.id).toBe(custom.id);
  });

  it('lists resolved rates by time and then by currency', () => {
    const rows = [rate(1, 'GBP', 100, 1n), rate(2, 'EUR', 100, 1n), rate(3, 'EUR', 50, 1n)];
    expect(resolveRates(rows).rates.map((r) => r.id)).toEqual([id(3), id(2), id(1)]);
  });
});
