import { CborError, decode, encode } from '../cbor/cbor';

// The parts of the op format the Core Worker needs on every operation, written without zod so the worker does not carry a
// schema library (the bundle budget). `op.ts` keeps the zod schemas as the readable specification and for contract tests;
// `op-wire.test.ts` proves the two accept and reject exactly the same bytes.

export type FieldValue = bigint | string | Uint8Array | boolean | null | FieldValue[] | { [key: string]: FieldValue };

export interface SetDeltaWire {
  add?: Uint8Array[] | undefined;
  rem?: Array<[Uint8Array, Uint8Array]> | undefined;
}

export interface OpPayload {
  t: number;
  f?: Map<number, FieldValue> | undefined;
  fx?: Map<number, SetDeltaWire> | undefined;
}

/** The fields of an op envelope that its signature covers. */
export interface OpEnvelopeSigned {
  readonly v: 1;
  readonly fold: Uint8Array;
  readonly op: Uint8Array;
  readonly rec: Uint8Array;
  readonly dev: Uint8Array;
  readonly seq: bigint;
  readonly hlc: { readonly wallMs: number; readonly ctr: number };
  readonly epoch: number;
  readonly schema: number;
  readonly blob: Uint8Array;
}

const SIGNING_LABEL = Uint8Array.from('cashfold.op.v1', (c) => c.charCodeAt(0));
const MIN_I64 = -(2n ** 63n);
const MAX_I64 = 2n ** 63n - 1n;

/** `"cashfold.op.v1" || canonical(fields 1..10)`: the bytes covered by the Ed25519 signature (field 11). */
export function opSigningBytes(e: OpEnvelopeSigned & { readonly sig?: Uint8Array }): Uint8Array {
  const body = encode(new Map<bigint, unknown>([
    [1n, 1], [2n, e.fold], [3n, e.op], [4n, e.rec], [5n, e.dev], [6n, e.seq], [7n, [e.hlc.wallMs, e.hlc.ctr]], [8n, e.epoch], [9n, e.schema], [10n, e.blob],
  ]) as never);
  const out = new Uint8Array(SIGNING_LABEL.length + body.length);
  out.set(SIGNING_LABEL);
  out.set(body, SIGNING_LABEL.length);
  return out;
}

export function encodeOpPayload(p: OpPayload): Uint8Array {
  return encode(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as never);
}

const bad = (what: string): never => {
  throw new CborError('unsupported_value', `invalid op payload: ${what}`);
};

const isBytes = (v: unknown, size?: number): v is Uint8Array => v instanceof Uint8Array && (size === undefined || v.length === size);

/** Reads a text-keyed CBOR map as a plain record; any other shape is rejected. */
function textMap(value: unknown, what: string): Map<string, unknown> {
  if (!(value instanceof Map)) return bad(what);
  for (const k of value.keys()) if (typeof k !== 'string') return bad(`${what} has a non-text key`);
  return value as Map<string, unknown>;
}

function fieldId(key: unknown): number {
  if (typeof key !== 'bigint' || key < 0n || key > 0xffffn) return bad('field id');
  return Number(key);
}

function fieldValue(v: unknown, depth: number): FieldValue {
  if (depth > 64) return bad('nesting');
  if (typeof v === 'bigint') return v >= MIN_I64 && v <= MAX_I64 ? v : bad('integer out of 64-bit range');
  if (typeof v === 'string' || typeof v === 'boolean' || v === null) return v;
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return v.map((x) => fieldValue(x, depth + 1));
  if (v instanceof Map) {
    const out: Record<string, FieldValue> = Object.create(null) as Record<string, FieldValue>;
    for (const [k, x] of textMap(v, 'map value')) out[k] = fieldValue(x, depth + 1);
    return out;
  }
  return bad('value');
}

function setDelta(v: unknown): SetDeltaWire {
  const m = textMap(v, 'set delta');
  for (const k of m.keys()) if (k !== 'add' && k !== 'rem') return bad('set delta field');
  const out: SetDeltaWire = {};
  if (m.has('add')) {
    const add = m.get('add');
    if (!Array.isArray(add) || !add.every((x) => isBytes(x, 16))) return bad('set additions');
    out.add = add as Uint8Array[];
  }
  if (m.has('rem')) {
    const rem = m.get('rem');
    if (!Array.isArray(rem) || !rem.every((x) => Array.isArray(x) && x.length === 2 && isBytes(x[0], 16) && isBytes(x[1], 16))) return bad('set removals');
    out.rem = rem as Array<[Uint8Array, Uint8Array]>;
  }
  return out;
}

export function decodeOpPayload(bytes: Uint8Array): OpPayload {
  const top = textMap(decode(bytes), 'payload');
  for (const k of top.keys()) if (k !== 't' && k !== 'f' && k !== 'fx') return bad('payload field');
  const t = top.get('t');
  if (typeof t !== 'bigint' || t < 1n || t > 14n) return bad('table');
  const out: OpPayload = { t: Number(t) };
  if (top.has('f')) {
    const f = top.get('f');
    if (!(f instanceof Map)) return bad('fields');
    out.f = new Map([...f].map(([k, v]) => [fieldId(k), fieldValue(v, 0)]));
  }
  if (top.has('fx')) {
    const fx = top.get('fx');
    if (!(fx instanceof Map)) return bad('set deltas');
    out.fx = new Map([...fx].map(([k, v]) => [fieldId(k), setDelta(v)]));
  }
  return out;
}
