import { z } from 'zod';

// Building blocks for contracts/op-envelope.cddl. Schemas validate *decoded CBOR*: integers arrive as
// bigint, maps as Map. Small integers (u8..u48) are narrowed to number; u64 and i64 stay bigint.

export const bytes = (size: number) =>
  z.instanceof(Uint8Array).refine((b) => b.length === size, { message: `expected ${size} bytes` });
export const bytesMin = (min: number) => z.instanceof(Uint8Array).refine((b) => b.length >= min, { message: `expected at least ${min} bytes` });
export const anyBytes = z.instanceof(Uint8Array);

export const uuid16 = bytes(16);
export const hash32 = bytes(32);
export const pk32 = bytes(32);
export const sig64 = bytes(64);

const uint = (max: bigint) => z.bigint().gte(0n).lte(max).transform((n) => Number(n));
export const u8 = uint(0xffn);
export const u16 = uint(0xffffn);
export const u32 = uint(0xffff_ffffn);
export const u48 = uint(0xffff_ffff_ffffn);
export const u64 = z.bigint().gte(0n).lte(2n ** 64n - 1n);
export const i64 = z.bigint().gte(-(2n ** 63n)).lte(2n ** 63n - 1n);
export const intRange = (min: bigint, max: bigint) => z.bigint().gte(min).lte(max).transform((n) => Number(n));

/** AEAD ciphertext: nonce(12) || ct || tag(16). */
export const aeadCt = bytesMin(28);

/** A CBOR map with text keys, validated as a plain object. */
export const textRecord = <S extends z.ZodRawShape>(shape: S) =>
  z.preprocess(textMapToObject, z.object(shape).strict());

/** Converts a text-keyed Map to a null-prototype object; anything else is left for zod to reject. */
export function textMapToObject(value: unknown): unknown {
  if (!(value instanceof Map)) return value;
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of value) {
    if (typeof k !== 'string') return value;
    out[k] = v;
  }
  return out;
}

/** Same, for integer-keyed maps: keys become the decimal strings "1", "2", ... */
export function intMapToObject(value: unknown): unknown {
  if (!(value instanceof Map)) return value;
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of value) {
    if (typeof k !== 'bigint') return value;
    out[k.toString()] = v;
  }
  return out;
}

/** Removes undefined-valued keys so optional fields are omitted from the wire map. */
export function stripUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
