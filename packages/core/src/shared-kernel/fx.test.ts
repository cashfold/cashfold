import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCurrency } from './currency';
import { exponentOf } from './currency';
import { convert } from './fx';
import { MAX_MINOR, MIN_MINOR, money } from './money';
import { PIVOT_RATE, rate } from './rate';

const cur = (code: string) => {
  const r = parseCurrency(code);
  if (!r.ok) throw new Error(code);
  return r.value;
};
const USD = cur('USD');
const EUR = cur('EUR');
const JPY = cur('JPY');
const BTC = cur('BTC');
const R = (n: bigint) => {
  const r = rate(n);
  if (!r.ok) throw new Error('bad rate');
  return r.value;
};
const M = (minor: bigint, c = USD) => {
  const r = money(minor, c);
  if (!r.ok) throw new Error('bad money');
  return r.value;
};
const conv = (a: ReturnType<typeof M>, to: typeof USD, rFrom: bigint, rTo: bigint) => {
  const r = convert(a, to, R(rFrom), R(rTo));
  return r.ok ? r.value.minor : r.error.code;
};

describe('rate', () => {
  it('requires 0 < rate_e12 <= 2^63-1', () => {
    expect(rate(0n).ok).toBe(false);
    expect(rate(-1n).ok).toBe(false);
    expect(rate(2n ** 63n).ok).toBe(false);
    expect(rate(1n).ok).toBe(true);
    expect(rate(2n ** 63n - 1n).ok).toBe(true);
    expect(PIVOT_RATE).toBe(10n ** 12n);
  });
});

describe('convert (single bigint division, half-even once)', () => {
  it('converts USD 100.00 to EUR at 0.9137', () => {
    expect(conv(M(10000n), EUR, 10n ** 12n, 913_700_000_000n)).toBe(9137n);
  });

  it('accounts for exponent differences', () => {
    expect(conv(M(10000n), JPY, 10n ** 12n, 150n * 10n ** 12n)).toBe(15000n); // $100.00 -> 15000 JPY
    expect(conv(M(15000n, JPY), USD, 150n * 10n ** 12n, 10n ** 12n)).toBe(10000n);
    expect(conv(M(100_000_000n, BTC), USD, 9_846_849n, 10n ** 12n)).toBe(10155533n); // 1 BTC at 9.846849e-6 BTC/USD
  });

  it('cross-converts through the USD pivot in one step', () => {
    // EUR 91.37 -> JPY at EUR 0.9137, JPY 150: 9137 * 1 * 150e12 / (100 * 913.7e9) = 15000
    expect(conv(M(9137n, EUR), JPY, 913_700_000_000n, 150n * 10n ** 12n)).toBe(15000n);
  });

  it('rounds half to even, symmetric for negatives', () => {
    const half = 5n * 10n ** 11n; // target rate 0.5 => y = a / 2
    const cases: Array<[bigint, bigint]> = [
      [1n, 0n], [3n, 2n], [5n, 2n], [7n, 4n], [-1n, 0n], [-3n, -2n], [-5n, -2n], [-7n, -4n],
    ];
    for (const [a, y] of cases) expect(conv(M(a), EUR, 10n ** 12n, half)).toBe(y);
  });

  it('is the identity for the same currency and rate', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: MIN_MINOR, max: MAX_MINOR }), fc.bigInt({ min: 1n, max: 2n ** 62n }), (a, r) => {
        expect(conv(M(a), USD, r, r)).toBe(a);
      }),
    );
  });

  it('range-checks the narrowed result', () => {
    expect(conv(M(MAX_MINOR), JPY, 10n ** 12n, 1000n * 10n ** 12n)).toBe('out_of_range');
    expect(conv(M(MIN_MINOR), JPY, 10n ** 12n, 1000n * 10n ** 12n)).toBe('out_of_range');
  });

  it('property: |convert(convert(a, X->Y), Y->X) - a| <= 1 when a Y minor unit is no larger than an X minor unit', () => {
    // Y minor value in X minor units: s = 10^eY * R_Y / (10^eX * R_X) >= 1.
    // Round trip error <= 1/2 + 1/(2s), so s >= 1 keeps it within 1. (With s < 1 the bound
    // does not hold: e.g. 400 BTC-satoshi -> 0 JPY -> 0.)
    const codes = [USD, EUR, JPY, BTC];
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(2n ** 40n), max: 2n ** 40n }),
        fc.constantFrom(...codes),
        fc.constantFrom(...codes),
        fc.bigInt({ min: 10n ** 6n, max: 10n ** 16n }),
        fc.bigInt({ min: 10n ** 6n, max: 10n ** 16n }),
        (a, x, y, rx, ry) => {
          const num = 10n ** BigInt(exponentOf(y)) * ry;
          const den = 10n ** BigInt(exponentOf(x)) * rx;
          fc.pre(num >= den);
          const there = convert(M(a, x), y, R(rx), R(ry));
          if (!there.ok) return;
          const back = convert(there.value, x, R(ry), R(rx));
          if (!back.ok) return;
          const err = back.value.minor - a;
          expect((err < 0n ? -err : err) <= 1n).toBe(true);
        },
      ),
    );
  });
});
