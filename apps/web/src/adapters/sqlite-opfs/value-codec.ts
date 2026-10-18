import type { FieldValue } from '@cashfold/core';
import { decode, encode, type CborValue } from '@cashfold/protocol';

// Field values are stored as deterministic CBOR so bigint, bytes, null and nested values survive exactly.

export function encodeValue(value: FieldValue): Uint8Array {
  return encode(value as CborValue);
}

function fromCbor(v: CborValue): FieldValue {
  if (v instanceof Map) {
    const out: { [key: string]: FieldValue } = {};
    for (const [k, x] of v) {
      if (typeof k !== 'string') throw new Error('stored field value has a non-text map key');
      out[k] = fromCbor(x);
    }
    return out;
  }
  if (Array.isArray(v)) return (v as readonly CborValue[]).map(fromCbor);
  if (typeof v === 'number') throw new Error('stored field value contains a non-bigint number');
  return v as FieldValue;
}

export function decodeValue(bytes: Uint8Array): FieldValue {
  return fromCbor(decode(bytes));
}
