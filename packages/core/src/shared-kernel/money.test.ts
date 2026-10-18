import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCurrency } from './currency.js';
import { MAX_MINOR, MIN_MINOR, add, divRoundHalfEven, money, negate, subtract } from './money.js';

const cur = (code: string) => {
  const r = parseCurrency(code);
  if (!r.ok) throw new Error(`bad currency ${code}`);
  return r.value;
};
const USD = cur('USD');
const EUR = cur('EUR');
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`unexpected error ${JSON.stringify(r.error)}`);
  return r.value;
};
const outOfRange = { ok: false, error: expect.objectContaining({ code: 'out_of_range' }) };

describe('Money construction', () => {
  it('accepts the exact signed 64-bit range', () => {
    expect(money(MAX_MINOR, USD).ok).toBe(true);
    expect(money(MIN_MINOR, USD).ok).toBe(true);
    expect(MAX_MINOR).toBe(2n ** 63n - 1n);
    expect(MIN_MINOR).toBe(-(2n ** 63n));
  });

  it('rejects values outside the range', () => {
    expect(money(MAX_MINOR + 1n, USD)).toEqual(outOfRange);
    expect(money(MIN_MINOR - 1n, USD)).toEqual(outOfRange);
  });

  it('handles values above 2^53 exactly', () => {
    const big = 2n ** 60n + 1n;
    expect(unwrap(money(big, USD)).minor).toBe(big);
  });
});

describe('Money arithmetic', () => {
  it('adds, subtracts and negates', () => {
    const a = unwrap(money(150n, USD));
    const b = unwrap(money(-40n, USD));
    expect(unwrap(add(a, b)).minor).toBe(110n);
    expect(unwrap(subtract(a, b)).minor).toBe(190n);
    expect(unwrap(negate(a)).minor).toBe(-150n);
  });

  it('refuses mixed currencies', () => {
    const r = add(unwrap(money(1n, USD)), unwrap(money(1n, EUR)));
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ code: 'currency_mismatch' }) });
    expect(subtract(unwrap(money(1n, USD)), unwrap(money(1n, EUR))).ok).toBe(false);
  });

  it('returns an error on overflow instead of wrapping', () => {
    const max = unwrap(money(MAX_MINOR, USD));
    const min = unwrap(money(MIN_MINOR, USD));
    expect(add(max, unwrap(money(1n, USD)))).toEqual(outOfRange);
    expect(subtract(min, unwrap(money(1n, USD)))).toEqual(outOfRange);
    expect(negate(min)).toEqual(outOfRange);
  });

  it('property: add matches the exact bigint sum whenever it is in range', () => {
    const minor = fc.bigInt({ min: MIN_MINOR, max: MAX_MINOR });
    fc.assert(
      fc.property(minor, minor, (x, y) => {
        const r = add(unwrap(money(x, USD)), unwrap(money(y, USD)));
        const exact = x + y;
        if (exact >= MIN_MINOR && exact <= MAX_MINOR) expect(unwrap(r).minor).toBe(exact);
        else expect(r.ok).toBe(false);
      }),
    );
  });

  it('property: subtract is the inverse of add', () => {
    const minor = fc.bigInt({ min: -(2n ** 62n), max: 2n ** 62n });
    fc.assert(
      fc.property(minor, minor, (x, y) => {
        const a = unwrap(money(x, USD));
        const b = unwrap(money(y, USD));
        expect(unwrap(subtract(unwrap(add(a, b)), b)).minor).toBe(x);
      }),
    );
  });
});

describe('divRoundHalfEven', () => {
  it('rounds ties to the even neighbour', () => {
    expect(divRoundHalfEven(1n, 2n)).toBe(0n);
    expect(divRoundHalfEven(3n, 2n)).toBe(2n);
    expect(divRoundHalfEven(5n, 2n)).toBe(2n);
    expect(divRoundHalfEven(7n, 2n)).toBe(4n);
    expect(divRoundHalfEven(-1n, 2n)).toBe(0n);
    expect(divRoundHalfEven(-3n, 2n)).toBe(-2n);
    expect(divRoundHalfEven(-5n, 2n)).toBe(-2n);
    expect(divRoundHalfEven(-7n, 2n)).toBe(-4n);
  });

  it('rounds non-ties to nearest, with either divisor sign', () => {
    expect(divRoundHalfEven(4n, 3n)).toBe(1n);
    expect(divRoundHalfEven(5n, 3n)).toBe(2n);
    expect(divRoundHalfEven(-4n, 3n)).toBe(-1n);
    expect(divRoundHalfEven(-5n, 3n)).toBe(-2n);
    expect(divRoundHalfEven(10n, -4n)).toBe(-2n);
  });

  it('is exact when the division is exact', () => {
    expect(divRoundHalfEven(12n, 4n)).toBe(3n);
    expect(divRoundHalfEven(0n, 7n)).toBe(0n);
  });

  it('rejects a zero divisor', () => {
    expect(() => divRoundHalfEven(1n, 0n)).toThrow();
  });

  it('property: within half a unit of the exact quotient, and ties are even', () => {
    const num = fc.bigInt({ min: -(2n ** 100n), max: 2n ** 100n });
    const den = fc.bigInt({ min: 1n, max: 2n ** 70n });
    fc.assert(
      fc.property(num, den, fc.boolean(), (n, d, flip) => {
        const dd = flip ? -d : d;
        const q = divRoundHalfEven(n, dd);
        const diff2 = 2n * n - 2n * q * dd; // |n/dd - q| <= 1/2  <=>  |2n - 2q*dd| <= |dd|
        const abs = diff2 < 0n ? -diff2 : diff2;
        expect(abs <= d).toBe(true);
        if (abs === d) expect(q % 2n).toBe(0n);
      }),
    );
  });
});
