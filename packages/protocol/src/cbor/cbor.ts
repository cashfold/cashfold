// Deterministic CBOR profile (RFC 8949 section 4.2.1, restricted):
//   - integers only, shortest form; no floats, tags, undefined or other simple values
//   - definite lengths only
//   - map keys are integers or text, sorted bytewise by their encoded form, no duplicates
//   - text is well-formed UTF-8
// Decoding is strict: anything the encoder would not produce is rejected.
// Integers decode to `bigint` always so 64-bit values never pass through a double.

export type CborKey = bigint | string;

export type CborValue =
  | bigint
  | number
  | string
  | Uint8Array
  | boolean
  | null
  | readonly CborValue[]
  | ReadonlyMap<CborKey | number, CborValue>
  | { readonly [key: string]: CborValue };

export type CborErrorCode =
  | 'non_shortest'
  | 'indefinite'
  | 'float'
  | 'tag'
  | 'unsupported_simple'
  | 'reserved'
  | 'truncated'
  | 'trailing_bytes'
  | 'invalid_utf8'
  | 'invalid_key'
  | 'duplicate_key'
  | 'unsorted_keys'
  | 'too_deep'
  | 'unsupported_value'
  | 'out_of_range';

export class CborError extends Error {
  constructor(readonly code: CborErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CborError';
  }
}

const MAX_DEPTH = 64;
const MAX_UINT = 2n ** 64n - 1n;
const MIN_INT = -(2n ** 64n);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// ---------------------------------------------------------------- encoder

function head(major: number, arg: bigint): Uint8Array {
  const m = major << 5;
  if (arg < 24n) return Uint8Array.of(m | Number(arg));
  if (arg < 0x100n) return Uint8Array.of(m | 24, Number(arg));
  if (arg < 0x10000n) return Uint8Array.of(m | 25, Number(arg >> 8n), Number(arg & 0xffn));
  const out = new Uint8Array(arg < 0x100000000n ? 5 : 9);
  const view = new DataView(out.buffer);
  if (arg < 0x100000000n) {
    out[0] = m | 26;
    view.setUint32(1, Number(arg));
  } else {
    out[0] = m | 27;
    view.setBigUint64(1, arg);
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

function isWellFormed(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function encodeInt(n: bigint): Uint8Array {
  if (n > MAX_UINT || n < MIN_INT) throw new CborError('out_of_range', 'integer outside the 64-bit CBOR range');
  return n >= 0n ? head(0, n) : head(1, -1n - n);
}

function encodeText(s: string): Uint8Array {
  if (!isWellFormed(s)) throw new CborError('invalid_utf8', 'string contains a lone surrogate');
  const bytes = textEncoder.encode(s);
  return concat([head(3, BigInt(bytes.length)), bytes]);
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

function encodeValue(v: unknown, depth: number): Uint8Array {
  if (depth > MAX_DEPTH) throw new CborError('too_deep');
  switch (typeof v) {
    case 'bigint':
      return encodeInt(v);
    case 'number':
      if (!Number.isSafeInteger(v)) throw new CborError('float', 'only safe integers may be passed as numbers; use bigint for 64-bit values');
      return encodeInt(BigInt(v));
    case 'string':
      return encodeText(v);
    case 'boolean':
      return Uint8Array.of(v ? 0xf5 : 0xf4);
    case 'object':
      break;
    default:
      throw new CborError('unsupported_value', `cannot encode ${typeof v}`);
  }
  if (v === null) return Uint8Array.of(0xf6);
  if (v instanceof Uint8Array) return concat([head(2, BigInt(v.length)), v]);
  if (Array.isArray(v)) return concat([head(4, BigInt(v.length)), ...v.map((x) => encodeValue(x, depth + 1))]);

  let entries: Array<[unknown, unknown]>;
  if (v instanceof Map) entries = [...v.entries()];
  else if (isPlainObject(v)) entries = Object.entries(v);
  else throw new CborError('unsupported_value', 'unsupported object type');

  const encoded = entries.map(([k, val]) => {
    if (typeof k !== 'string' && typeof k !== 'bigint' && !(typeof k === 'number' && Number.isSafeInteger(k))) {
      throw new CborError('invalid_key', 'map keys must be integers or text');
    }
    return { key: encodeValue(k, depth + 1), value: encodeValue(val, depth + 1) };
  });
  encoded.sort((a, b) => compareBytes(a.key, b.key));
  for (let i = 1; i < encoded.length; i++) {
    if (compareBytes(encoded[i - 1]!.key, encoded[i]!.key) === 0) throw new CborError('duplicate_key');
  }
  return concat([head(5, BigInt(encoded.length)), ...encoded.flatMap((e) => [e.key, e.value])]);
}

export function encode(value: CborValue): Uint8Array {
  return encodeValue(value, 0);
}

// ---------------------------------------------------------------- decoder

class Reader {
  pos = 0;
  constructor(readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  take(n: number): Uint8Array {
    if (n > this.remaining) throw new CborError('truncated');
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

/** Reads the argument of an initial byte; enforces shortest form. Returns null for the indefinite marker. */
function readArg(r: Reader, ai: number): bigint | null {
  if (ai < 24) return BigInt(ai);
  if (ai === 31) return null;
  if (ai > 27) throw new CborError('reserved', `reserved additional information ${ai}`);
  const size = 1 << (ai - 24);
  const view = new DataView(r.take(size).slice().buffer);
  const arg = size === 1 ? BigInt(view.getUint8(0)) : size === 2 ? BigInt(view.getUint16(0)) : size === 4 ? BigInt(view.getUint32(0)) : view.getBigUint64(0);
  const min = size === 1 ? 24n : size === 2 ? 0x100n : size === 4 ? 0x10000n : 0x100000000n;
  if (arg < min) throw new CborError('non_shortest');
  return arg;
}

function readLength(r: Reader, arg: bigint | null, unitBytes: number): number {
  if (arg === null) throw new CborError('indefinite');
  if (arg * BigInt(unitBytes) > BigInt(r.remaining)) throw new CborError('truncated');
  return Number(arg);
}

function decodeValue(r: Reader, depth: number): CborValue {
  if (depth > MAX_DEPTH) throw new CborError('too_deep');
  const initial = r.take(1)[0]!;
  const major = initial >> 5;
  const ai = initial & 31;

  if (major === 7) {
    if (ai === 20) return false;
    if (ai === 21) return true;
    if (ai === 22) return null;
    if (ai >= 25 && ai <= 27) throw new CborError('float');
    if (ai === 31) throw new CborError('indefinite', 'unexpected break');
    throw new CborError('unsupported_simple');
  }

  const arg = readArg(r, ai);
  switch (major) {
    case 0:
      if (arg === null) throw new CborError('indefinite');
      return arg;
    case 1:
      if (arg === null) throw new CborError('indefinite');
      return -1n - arg;
    case 2:
      return r.take(readLength(r, arg, 1)).slice();
    case 3: {
      try {
        return textDecoder.decode(r.take(readLength(r, arg, 1)));
      } catch (e) {
        if (e instanceof CborError) throw e;
        throw new CborError('invalid_utf8');
      }
    }
    case 4: {
      const n = readLength(r, arg, 1);
      const out: CborValue[] = [];
      for (let i = 0; i < n; i++) out.push(decodeValue(r, depth + 1));
      return out;
    }
    case 5: {
      const n = readLength(r, arg, 2);
      const out = new Map<CborKey, CborValue>();
      let previous: Uint8Array | null = null;
      for (let i = 0; i < n; i++) {
        const start = r.pos;
        const key = decodeValue(r, depth + 1);
        if (typeof key !== 'bigint' && typeof key !== 'string') throw new CborError('invalid_key', 'map keys must be integers or text');
        const keyBytes = r.bytes.subarray(start, r.pos);
        if (previous !== null) {
          const order = compareBytes(previous, keyBytes);
          if (order === 0) throw new CborError('duplicate_key');
          if (order > 0) throw new CborError('unsorted_keys');
        }
        previous = keyBytes;
        out.set(key, decodeValue(r, depth + 1));
      }
      return out;
    }
    default:
      throw new CborError('tag', 'tags are not part of the profile');
  }
}

export function decode(bytes: Uint8Array): CborValue {
  const reader = new Reader(bytes);
  const value = decodeValue(reader, 0);
  if (reader.remaining !== 0) throw new CborError('trailing_bytes');
  return value;
}
