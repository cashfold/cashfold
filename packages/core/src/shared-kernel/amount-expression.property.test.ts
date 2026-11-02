import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Separators } from './amount-text';
import { evaluateAmount } from './amount-expression';
import { exponentOf, parseCurrency } from './currency';
import { divRoundHalfEven } from './money';

// Exactness against a reference (spec 020, SC-002): random sums over small integers and decimals, evaluated by the module, equal the same sum worked
// out here with bigint fractions and one half-even rounding.

const cur = (code: string) => {
  const r = parseCurrency(code);
  if (!r.ok) throw new Error(code);
  return r.value;
};
const EN: Separators = { decimal: '.', group: ',' };
const CURRENCIES = [cur('JPY'), cur('USD'), cur('BHD')];

interface Frac { n: bigint; d: bigint }
const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};
const norm = (n: bigint, d: bigint): Frac => {
  const g = gcd(n, d) || 1n;
  const s = d < 0n ? -1n : 1n;
  return { n: (s * n) / g, d: (s * d) / g };
};

type Tree = { k: 'num'; text: string; v: Frac } | { k: 'bin'; op: '+' | '-' | '*' | '/'; a: Tree; b: Tree } | { k: 'group'; of: Tree };

const numTree: fc.Arbitrary<Tree> = fc.tuple(fc.nat(9_999), fc.integer({ min: 0, max: 3 })).map(([whole, decimals]) => {
  const digits = whole.toString().padStart(decimals + 1, '0');
  const text = decimals === 0 ? digits : `${digits.slice(0, digits.length - decimals)}.${digits.slice(digits.length - decimals)}`;
  return { k: 'num', text, v: norm(BigInt(whole), 10n ** BigInt(decimals)) } as Tree;
});
const tree: fc.Arbitrary<Tree> = fc.letrec<{ t: Tree }>((tie) => ({
  t: fc.oneof(
    { depthSize: 'small', maxDepth: 4 },
    numTree,
    fc.record({ k: fc.constant('bin' as const), op: fc.constantFrom('+', '-', '*', '/') as fc.Arbitrary<'+' | '-' | '*' | '/'>, a: tie('t'), b: tie('t') }) as fc.Arbitrary<Tree>,
    tie('t').map((of): Tree => ({ k: 'group', of })),
  ),
})).t;

const show = (t: Tree): string => (t.k === 'num' ? t.text : t.k === 'group' ? `(${show(t.of)})` : `${show(t.a)} ${t.op} ${show(t.b)}`);

/** Standard precedence over bigint fractions; `undefined` for a division by zero. A binary node is a single operation only inside brackets or as a root. */
function value(t: Tree): Frac | undefined {
  if (t.k === 'num') return t.v;
  if (t.k === 'group') return value(t.of);
  const a = value(t.a);
  const b = value(t.b);
  if (a === undefined || b === undefined) return undefined;
  if (t.op === '+') return norm(a.n * b.d + b.n * a.d, a.d * b.d);
  if (t.op === '-') return norm(a.n * b.d - b.n * a.d, a.d * b.d);
  if (t.op === '*') return norm(a.n * b.n, a.d * b.d);
  return b.n === 0n ? undefined : norm(a.n * b.d, a.d * b.n);
}

/** Printing a tree without brackets would change its meaning, so every binary child of a binary node is bracketed: the reference then needs no precedence rules. */
function bracketed(t: Tree): Tree {
  if (t.k === 'num') return t;
  if (t.k === 'group') return { k: 'group', of: bracketed(t.of) };
  const wrap = (c: Tree): Tree => (c.k === 'bin' ? { k: 'group', of: bracketed(c) } : bracketed(c));
  return { k: 'bin', op: t.op, a: wrap(t.a), b: wrap(t.b) };
}

describe('evaluateAmount is exact (property)', () => {
  for (const currency of CURRENCIES) {
    it(`matches a bigint reference rounded once, half to even, in ${currency}`, () => {
      fc.assert(
        fc.property(tree, (raw) => {
          const t = bracketed(raw);
          const exact = value(t);
          const got = evaluateAmount(show(t), currency, EN);
          if (exact === undefined) {
            expect(got.ok ? 'ok' : got.error.code).toBe('division_by_zero');
            return;
          }
          const expected = divRoundHalfEven(exact.n * 10n ** BigInt(exponentOf(currency)), exact.d);
          expect(got.ok ? got.value.minor : got.error.code).toBe(expected);
        }),
        { numRuns: 1_000 },
      );
    });
  }

  it('a + b - b equals a, and x * y / y equals x, for a non-zero y', () => {
    const amount = fc.tuple(fc.nat(99_999), fc.constantFrom(0, 1, 2, 3)).map(([n, dec]) => (dec === 0 ? `${n}` : `${Math.floor(n / 10 ** dec)}.${String(n % 10 ** dec).padStart(dec, '0')}`));
    fc.assert(
      fc.property(amount, amount, amount, (a, b, y) => {
        const c = cur('BHD');
        const plain = evaluateAmount(a, c, EN);
        const around = evaluateAmount(`${a} + ${b} - ${b}`, c, EN);
        expect(around).toEqual(plain);
        const nonZero = evaluateAmount(y, c, EN);
        if (nonZero.ok && nonZero.value.minor !== 0n) expect(evaluateAmount(`(${a}) * ${y} / ${y}`, c, EN)).toEqual(plain);
      }),
      { numRuns: 500 },
    );
  });

  it('never throws, whatever the text', () => {
    fc.assert(fc.property(fc.string({ maxLength: 260 }), (text) => {
      expect(() => evaluateAmount(text, cur('USD'), EN)).not.toThrow();
    }), { numRuns: 1_000 });
    fc.assert(fc.property(fc.stringMatching(/^[0-9 .,+\-*/()x×÷−]{0,60}$/), (text) => {
      expect(() => evaluateAmount(text, cur('USD'), EN)).not.toThrow();
    }), { numRuns: 2_000 });
  });
});
