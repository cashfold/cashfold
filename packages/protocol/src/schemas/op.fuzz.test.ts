import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { CborError } from '../cbor/cbor';
import {
  decodeFoldKeyGrant, decodeFrame, decodeKeySet, decodeLogEntry, decodeOpEnvelope, decodeOpPayload, decodeSnapshot,
  encodeOpEnvelope, encodeOpPayload, type FieldValue, type OpEnvelope, type OpPayload,
} from './index';

const NUM_RUNS = process.env['CI'] ? 5000 : 1000;

const parsers: Array<[string, (b: Uint8Array) => unknown]> = [
  ['op-envelope', decodeOpEnvelope],
  ['op-payload', decodeOpPayload],
  ['key set', decodeKeySet],
  ['fold key grant', decodeFoldKeyGrant],
  ['log entry', decodeLogEntry],
  ['snapshot', decodeSnapshot],
  ['frame', decodeFrame],
];

const cleanOrReject = (parse: (b: Uint8Array) => unknown, bytes: Uint8Array): void => {
  try {
    parse(bytes);
  } catch (e) {
    if (!(e instanceof CborError) && !(e instanceof ZodError)) throw e;
  }
};

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);
const envelope: OpEnvelope = {
  v: 1, fold: bytes(16, 1), op: bytes(16, 2), rec: bytes(16, 3), dev: bytes(16, 4), seq: 42n, hlc: { wallMs: 1_700_000_000_000, ctr: 1 },
  epoch: 1, schema: 1, blob: bytes(284, 9), sig: bytes(64, 5),
};
const payload: OpPayload = { t: 6, f: new Map<number, FieldValue>([[1, 100n], [2, 'x'], [3, [1n, null, true]]]) };

describe('wire parsers never fail with anything but CborError or ZodError', () => {
  it.each(parsers)('%s: random bytes', (_name, parse) => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 200 }), (b) => cleanOrReject(parse, b)), { numRuns: NUM_RUNS });
  });

  it('op-envelope: single-byte mutations of a valid envelope', () => {
    const valid = encodeOpEnvelope(envelope);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: valid.length - 1 }), fc.integer({ min: 0, max: 255 }), (pos, value) => {
        const mutated = Uint8Array.from(valid);
        mutated[pos] = value;
        try {
          const parsed = decodeOpEnvelope(mutated);
          // Accepted mutations must still be canonical.
          expect(Array.from(encodeOpEnvelope(parsed))).toEqual(Array.from(mutated));
        } catch (e) {
          if (!(e instanceof CborError) && !(e instanceof ZodError)) throw e;
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('op-envelope: truncation and extension are always rejected', () => {
    const valid = encodeOpEnvelope(envelope);
    for (let n = 0; n < valid.length; n += 7) expect(() => decodeOpEnvelope(valid.slice(0, n))).toThrow();
    expect(() => decodeOpEnvelope(Uint8Array.from([...valid, 0]))).toThrow();
  });

  it('op-payload: single-byte mutations of a valid payload', () => {
    const valid = encodeOpPayload(payload);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: valid.length - 1 }), fc.integer({ min: 0, max: 255 }), (pos, value) => {
        const mutated = Uint8Array.from(valid);
        mutated[pos] = value;
        cleanOrReject(decodeOpPayload, mutated);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('op-envelope round-trips for random valid field values', () => {
    const arb = fc.record({
      v: fc.constant(1 as const),
      fold: fc.uint8Array({ minLength: 16, maxLength: 16 }),
      op: fc.uint8Array({ minLength: 16, maxLength: 16 }),
      rec: fc.uint8Array({ minLength: 16, maxLength: 16 }),
      dev: fc.uint8Array({ minLength: 16, maxLength: 16 }),
      seq: fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
      hlc: fc.record({ wallMs: fc.integer({ min: 0, max: 2 ** 48 - 1 }), ctr: fc.integer({ min: 0, max: 65535 }) }),
      epoch: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
      schema: fc.integer({ min: 0, max: 65535 }),
      blob: fc.uint8Array({ minLength: 28, maxLength: 400 }),
      sig: fc.uint8Array({ minLength: 64, maxLength: 64 }),
    });
    fc.assert(
      fc.property(arb, (e) => {
        expect(decodeOpEnvelope(encodeOpEnvelope(e as OpEnvelope))).toEqual(e);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
