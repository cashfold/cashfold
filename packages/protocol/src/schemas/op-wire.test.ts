import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CborError, decode, encode } from '../cbor/cbor';
import { OpPayloadSchema } from './op';
import { decodeOpPayload, encodeOpPayload, opSigningBytes, type FieldValue } from './op-wire';

// The zod schema is the specification of the op payload; the hand-written decoder is what the worker runs. They must
// accept the same bytes and produce the same value.

const u16 = fc.integer({ min: 0, max: 0xffff });
const id16 = fc.uint8Array({ minLength: 16, maxLength: 16 });
const value: fc.Arbitrary<FieldValue> = fc.letrec((tie) => ({
  v: fc.oneof(
    fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }), fc.string(), fc.uint8Array({ maxLength: 8 }), fc.boolean(), fc.constant(null),
    fc.array(tie('v') as fc.Arbitrary<FieldValue>, { maxLength: 3 }), fc.dictionary(fc.string({ maxLength: 4 }), tie('v') as fc.Arbitrary<FieldValue>, { maxKeys: 3 }) as fc.Arbitrary<FieldValue>,
  ),
})).v as fc.Arbitrary<FieldValue>;

const payloads = fc.record({
  t: fc.integer({ min: 1, max: 14 }),
  f: fc.option(fc.array(fc.tuple(u16, value), { maxLength: 4 }).map((e) => new Map(e)), { nil: undefined }),
  fx: fc.option(fc.array(fc.tuple(u16, fc.record({ add: fc.array(id16, { maxLength: 3 }), rem: fc.array(fc.tuple(id16, id16), { maxLength: 3 }) }, { requiredKeys: [] })), { maxLength: 3 }).map((e) => new Map(e)), { nil: undefined }),
}, { requiredKeys: ['t'] });

function both(bytes: Uint8Array): { zod: unknown; fast: unknown } {
  const run = (f: () => unknown): unknown => {
    try {
      return f();
    } catch (e) {
      if (e instanceof CborError || (e as Error).name === 'ZodError') return 'rejected';
      throw e;
    }
  };
  return { zod: run(() => OpPayloadSchema.parse(decode(bytes))), fast: run(() => decodeOpPayload(bytes)) };
}

describe('decodeOpPayload (hand-written) agrees with the schema', () => {
  it('reads every valid payload to the same value', () => {
    fc.assert(
      fc.property(payloads, (p) => {
        const bytes = encodeOpPayload(p as never);
        const { zod, fast } = both(bytes);
        expect(fast).toEqual(zod);
        expect(fast).not.toBe('rejected');
      }),
      { numRuns: 500 },
    );
  });

  it('rejects the same malformed payloads', () => {
    const bad: unknown[] = [
      { t: 0 }, { t: 15 }, { t: 6, extra: 1 }, { f: new Map() }, { t: 6, f: [] }, { t: 6, f: new Map([[65536, 1]]) },
      { t: 6, f: new Map([[-1, 1]]) }, { t: 6, f: new Map([['a', 1]]) }, { t: 6, f: new Map([[1, 2n ** 63n]]) }, { t: 6, f: new Map([[1, -(2n ** 63n) - 1n]]) },
      { t: 6, f: new Map([[1, new Map([[1, 2]])]]) }, { t: 6, fx: new Map([[1, { add: [new Uint8Array(15)] }]]) },
      { t: 6, fx: new Map([[1, { rem: [[new Uint8Array(16)]] }]]) }, { t: 6, fx: new Map([[1, { other: [] }]]) }, { t: 6, fx: [] },
      { t: 6, fx: new Map([[1, { add: 'x' }]]) }, { t: 6, fx: new Map([[1, 5]]) }, [], 5, 'x', null,
    ];
    for (const input of bad) {
      const bytes = encode(input as never);
      const { zod, fast } = both(bytes);
      expect(zod, JSON.stringify(input, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v instanceof Map ? [...v] : v))).toBe('rejected');
      expect(fast).toBe('rejected');
    }
  });

  it('agrees on single-byte mutations of valid payloads', () => {
    const valid = encodeOpPayload({ t: 6, f: new Map<number, FieldValue>([[1, 100n], [2, 'x'], [3, [1n, null, true, { a: 2n }]]]), fx: new Map([[4, { add: [new Uint8Array(16)], rem: [[new Uint8Array(16), new Uint8Array(16).fill(1)]] }]]) });
    for (let pos = 0; pos < valid.length; pos++) {
      for (const byte of [0, 1, 0x20, 0x7f, 0xff]) {
        const mutated = Uint8Array.from(valid);
        mutated[pos] = byte;
        const { zod, fast } = both(mutated);
        expect(fast, `byte ${pos}=${byte}`).toEqual(zod);
      }
    }
  });
});

describe('opSigningBytes', () => {
  it('prefixes the label to the canonical fields 1 to 10 and ignores the signature', () => {
    const e = { v: 1 as const, fold: new Uint8Array(16).fill(1), op: new Uint8Array(16).fill(2), rec: new Uint8Array(16).fill(3), dev: new Uint8Array(16).fill(4), seq: 7n, hlc: { wallMs: 5, ctr: 1 }, epoch: 1, schema: 1, blob: new Uint8Array(30).fill(9) };
    const a = opSigningBytes(e);
    expect(new TextDecoder().decode(a.slice(0, 14))).toBe('cashfold.op.v1');
    expect(opSigningBytes({ ...e, sig: new Uint8Array(64).fill(5) })).toEqual(a);
    expect(opSigningBytes({ ...e, seq: 8n })).not.toEqual(a);
  });
});
