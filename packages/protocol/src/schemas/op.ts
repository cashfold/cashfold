import { z } from 'zod';
import { decode, encode } from '../cbor/cbor';
import { anyBytes, i64, intMapToObject, intRange, sig64, textRecord, u16, u32, u48, u64, uuid16, bytesMin } from './primitives';

// ---------------------------------------------------------------- op-envelope (integer keys 1..11)

const hlc = z.tuple([u48, u16]).transform(([wallMs, ctr]) => ({ wallMs, ctr }));

const envelopeWire = z.preprocess(
  intMapToObject,
  z
    .object({
      '1': z.literal(1n),
      '2': uuid16,
      '3': uuid16,
      '4': uuid16,
      '5': uuid16,
      '6': u64,
      '7': hlc,
      '8': u32,
      '9': u16,
      '10': bytesMin(28),
      '11': sig64,
    })
    .strict(),
);

export const OpEnvelopeSchema = envelopeWire.transform((w) => ({
  v: 1 as const,
  fold: w['2'],
  op: w['3'],
  rec: w['4'],
  dev: w['5'],
  seq: w['6'],
  hlc: w['7'],
  epoch: w['8'],
  schema: w['9'],
  blob: w['10'],
  sig: w['11'],
}));

export type OpEnvelope = z.output<typeof OpEnvelopeSchema>;

function envelopeFields(e: OpEnvelope): Map<bigint, unknown> {
  return new Map<bigint, unknown>([
    [1n, 1],
    [2n, e.fold],
    [3n, e.op],
    [4n, e.rec],
    [5n, e.dev],
    [6n, e.seq],
    [7n, [e.hlc.wallMs, e.hlc.ctr]],
    [8n, e.epoch],
    [9n, e.schema],
    [10n, e.blob],
  ]);
}

export function encodeOpEnvelope(e: OpEnvelope): Uint8Array {
  const fields = envelopeFields(e);
  fields.set(11n, e.sig);
  return encode(fields as never);
}

export function decodeOpEnvelope(bytes: Uint8Array): OpEnvelope {
  return OpEnvelopeSchema.parse(decode(bytes));
}

// ---------------------------------------------------------------- op-payload (plaintext inside the blob)

export { decodeOpPayload, encodeOpPayload, opSigningBytes, type FieldValue, type OpPayload, type OpEnvelopeSigned } from './op-wire';
import type { FieldValue } from './op-wire';

const fieldValue: z.ZodType<FieldValue, unknown> = z.lazy(() =>
  z.union([
    i64, // amounts: out-of-i64 integers are rejected
    z.string(),
    anyBytes,
    z.boolean(),
    z.null(),
    z.array(fieldValue),
    z.preprocess(
      (v) => (v instanceof Map ? textMapToRecord(v) : v),
      z.record(z.string(), fieldValue),
    ),
  ]),
) as z.ZodType<FieldValue, unknown>;

function textMapToRecord(m: Map<unknown, unknown>): unknown {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of m) {
    if (typeof k !== 'string') return m;
    out[k] = v;
  }
  return out;
}

const fieldId = intRange(0n, 0xffffn);

const setDelta = textRecord({
  add: z.array(uuid16).optional(),
  rem: z.array(z.tuple([uuid16, uuid16])).optional(),
  tagged: z.array(z.tuple([uuid16, uuid16])).optional(),
});

export const OpPayloadSchema = textRecord({
  t: intRange(1n, 14n),
  f: z.map(fieldId, fieldValue).optional(),
  fx: z.map(fieldId, setDelta).optional(),
});

