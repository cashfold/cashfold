import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import vectors from '../../../../vectors/cbor/deterministic.json' with { type: 'json' };
import { CborError, decode, encode, type CborValue } from './cbor';

const hex = (s: string): Uint8Array => Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.slice(i * 2, i * 2 + 2), 16));
const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

type Desc =
  | { int: string }
  | { text: string }
  | { bytes: string }
  | { bool: boolean }
  | { null: true }
  | { array: Desc[] }
  | { map: [Desc, Desc][] };

/** Builds the canonical decoded shape (integers as bigint, maps as Map) from a vector descriptor. */
function build(d: Desc): CborValue {
  if ('int' in d) return BigInt(d.int);
  if ('text' in d) return d.text;
  if ('bytes' in d) return hex(d.bytes);
  if ('bool' in d) return d.bool;
  if ('null' in d) return null;
  if ('array' in d) return d.array.map(build);
  return new Map(d.map.map(([k, v]) => [build(k) as bigint | string, build(v)]));
}

describe('frozen deterministic vectors', () => {
  for (const v of vectors.valid) {
    it(`encodes ${v.name}`, () => {
      expect(toHex(encode(build(v.value as Desc)))).toBe(v.hex);
    });
    it(`decodes ${v.name}`, () => {
      expect(decode(hex(v.hex))).toEqual(build(v.value as Desc));
    });
  }

  for (const v of vectors.invalid) {
    it(`rejects ${v.name}`, () => {
      expect(() => decode(hex(v.hex))).toThrow(CborError);
    });
  }
});

describe('encoder', () => {
  it('accepts safe-integer numbers as integers and bigint for 64-bit values', () => {
    expect(toHex(encode(1000))).toBe('1903e8');
    expect(toHex(encode(-1000))).toBe('3903e7');
    expect(toHex(encode(2n ** 64n - 1n))).toBe('1bffffffffffffffff');
  });

  it('rejects floats, NaN, infinities and unsafe numbers', () => {
    for (const bad of [1.5, NaN, Infinity, -Infinity, 2 ** 53, -(2 ** 53)]) {
      expect(() => encode(bad)).toThrow(CborError);
    }
  });

  it('rejects out-of-range bigints', () => {
    expect(() => encode(2n ** 64n)).toThrow(CborError);
    expect(() => encode(-(2n ** 64n) - 1n)).toThrow(CborError);
  });

  it('rejects unsupported values', () => {
    for (const bad of [undefined, Symbol('x'), () => 1, new Date(), new Set([1])] as unknown[]) {
      expect(() => encode(bad as CborValue)).toThrow(CborError);
    }
  });

  it('sorts plain-object keys deterministically and ignores insertion order', () => {
    expect(toHex(encode({ b: 1, a: 2 }))).toBe('a2616102616201');
    expect(toHex(encode({ a: 2, b: 1 }))).toBe('a2616102616201');
  });

  it('rejects maps whose keys collide after encoding (1 and 1n)', () => {
    const m = new Map<bigint | string, CborValue>([[1n, 0], [1n, 1]]);
    expect(encode(m)).toBeDefined(); // a JS Map cannot hold duplicate keys
    const dup = new Map<bigint | string | number, CborValue>([[1, 0], [1n, 1]]);
    expect(() => encode(dup as unknown as CborValue)).toThrow(CborError);
  });

  it('rejects excessive nesting', () => {
    let v: CborValue = 0;
    for (let i = 0; i < 100; i++) v = [v];
    expect(() => encode(v)).toThrow(CborError);
  });
});

describe('decoder limits', () => {
  it('rejects excessive nesting', () => {
    const bytes = new Uint8Array(101).fill(0x81);
    bytes[100] = 0x00;
    expect(() => decode(bytes)).toThrow(CborError);
  });

  it('exposes a machine-readable error code', () => {
    try {
      decode(hex('1800'));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CborError);
      expect((e as CborError).code).toBe('non_shortest');
    }
  });
});

const cborValue: fc.Arbitrary<CborValue> = fc.letrec<{ v: CborValue; key: bigint | string }>((tie) => ({
  key: fc.oneof(fc.bigInt({ min: -(2n ** 64n), max: 2n ** 64n - 1n }), fc.string({ unit: 'binary' })),
  v: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.bigInt({ min: -(2n ** 64n), max: 2n ** 64n - 1n }),
    fc.string({ unit: 'binary' }),
    fc.uint8Array({ maxLength: 40 }),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('v'), { maxLength: 4 }),
    fc.array(fc.tuple(tie('key'), tie('v')), { maxLength: 4 }).map((es) => new Map(es) as ReadonlyMap<bigint | string, CborValue>),
  ),
})).v;

describe('properties', () => {
  it('decode(encode(v)) equals v', () => {
    fc.assert(
      fc.property(cborValue, (v) => {
        expect(decode(encode(v))).toEqual(v);
      }),
    );
  });

  it('encoding is canonical: encode(decode(bytes)) reproduces accepted bytes exactly', () => {
    fc.assert(
      fc.property(cborValue, (v) => {
        const bytes = encode(v);
        expect(toHex(encode(decode(bytes)))).toBe(toHex(bytes));
      }),
    );
  });

  it('map encoding does not depend on insertion order', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.string({ maxLength: 6 }), fc.integer({ min: 0, max: 99 })), { maxLength: 8 }), (entries) => {
        const unique = [...new Map(entries).entries()];
        const a = new Map<string, CborValue>(unique);
        const b = new Map<string, CborValue>([...unique].reverse());
        expect(toHex(encode(a))).toBe(toHex(encode(b)));
      }),
    );
  });

  it('never accepts a one-bit mutation as a different canonical value silently: result is an error or re-encodes to the mutated bytes', () => {
    fc.assert(
      fc.property(cborValue, fc.nat(), fc.integer({ min: 0, max: 7 }), (v, pos, bit) => {
        const bytes = encode(v);
        const mutated = Uint8Array.from(bytes);
        mutated[pos % mutated.length] = mutated[pos % mutated.length]! ^ (1 << bit);
        try {
          expect(toHex(encode(decode(mutated)))).toBe(toHex(mutated));
        } catch (e) {
          if (!(e instanceof CborError)) throw e;
        }
      }),
    );
  });
});
