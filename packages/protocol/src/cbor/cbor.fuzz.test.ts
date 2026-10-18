import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CborError, decode, encode } from './cbor.js';

const NUM_RUNS = process.env['CI'] ? 5000 : 1000;

function decodesOrRejectsCleanly(bytes: Uint8Array): void {
  try {
    const value = decode(bytes);
    // Anything accepted must be canonical: re-encoding reproduces the exact input.
    expect(Array.from(encode(value))).toEqual(Array.from(bytes));
  } catch (e) {
    if (!(e instanceof CborError)) throw e;
  }
}

describe('CBOR decoder fuzzing', () => {
  it('random bytes: only CborError, never another exception', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 256 }), decodesOrRejectsCleanly), { numRuns: NUM_RUNS });
  });

  it('structured: bytes biased toward CBOR heads and lengths', () => {
    const head = fc.oneof(
      fc.integer({ min: 0, max: 255 }).map((b) => [b]),
      fc.constantFrom(0x18, 0x19, 0x1a, 0x1b, 0x38, 0x58, 0x78, 0x98, 0xb8, 0x9f, 0xbf, 0xff, 0xf9, 0xfb, 0xc0).chain((b) => fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 9 }).map((rest) => [b, ...rest])),
    );
    fc.assert(fc.property(fc.array(head, { maxLength: 24 }).map((parts) => Uint8Array.from(parts.flat())), decodesOrRejectsCleanly), { numRuns: NUM_RUNS });
  });

  it('truncating any valid encoding is rejected', () => {
    const value = new Map<string, unknown>([['a', [1n, 'two', new Uint8Array(5)]], ['b', new Map([[1n, true]])]]);
    const bytes = encode(value as never);
    for (let n = 0; n < bytes.length; n++) {
      expect(() => decode(bytes.slice(0, n))).toThrow(CborError);
    }
  });

  it('appending bytes to a valid encoding is rejected', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 8 }), (extra) => {
        const bytes = Uint8Array.from([...encode([1n, 2n]), ...extra]);
        expect(() => decode(bytes)).toThrow(CborError);
      }),
    );
  });

  it('hostile length claims do not allocate or hang', () => {
    const started = performance.now();
    for (const head of [[0x9b], [0x5b], [0x7b], [0xbb]]) {
      expect(() => decode(Uint8Array.from([...head, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))).toThrow(CborError);
      expect(() => decode(Uint8Array.from([...head, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))).toThrow(CborError);
    }
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('deep nesting is rejected without stack overflow', () => {
    expect(() => decode(new Uint8Array(200_000).fill(0x81))).toThrow(CborError);
    expect(() => decode(new Uint8Array(200_000).fill(0xa1))).toThrow(CborError);
  });
});
