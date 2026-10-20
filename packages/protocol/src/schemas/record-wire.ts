import { decode, encode } from '../cbor/cbor';

// Hand-written decoders for the three structures the browser's worker reads from the service: the op envelope, the personal
// key set and a Fold-key grant. They accept exactly what the zod schemas accept (record-wire.test.ts proves it on random
// and on mutated input) but do not import zod, which would add several hundred kilobytes to the worker.

export class WireError extends Error {
  constructor(what: string) {
    super(`malformed ${what}`);
    this.name = 'WireError';
  }
}

type Bytes = Uint8Array;
const fail = (what: string): never => {
  throw new WireError(what);
};
const isBytes = (v: unknown, n?: number): v is Bytes => v instanceof Uint8Array && (n === undefined || v.length === n);
const bytes = (v: unknown, what: string, n?: number): Bytes => (isBytes(v, n) ? v : fail(what));
const uint = (v: unknown, what: string, max: bigint): number => (typeof v === 'bigint' && v >= 0n && v <= max ? Number(v) : fail(what));
const u64 = (v: unknown, what: string): bigint => (typeof v === 'bigint' && v >= 0n && v <= 2n ** 64n - 1n ? v : fail(what));
const exactKeys = (m: ReadonlyMap<unknown, unknown>, keys: readonly (string | bigint)[], what: string): void => {
  if (m.size !== keys.length || !keys.every((k) => m.has(k))) fail(what);
};

// ---------------------------------------------------------------- op envelope (integer keys 1..11)

export interface OpEnvelopeWire {
  readonly v: 1;
  readonly fold: Bytes;
  readonly op: Bytes;
  readonly rec: Bytes;
  readonly dev: Bytes;
  readonly seq: bigint;
  readonly hlc: { readonly wallMs: number; readonly ctr: number };
  readonly epoch: number;
  readonly schema: number;
  readonly blob: Bytes;
  readonly sig: Bytes;
}

export function decodeOpEnvelopeWire(input: Bytes): OpEnvelopeWire {
  const m = decode(input);
  if (!(m instanceof Map)) return fail('envelope');
  exactKeys(m, [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 11n], 'envelope');
  if (m.get(1n) !== 1n) fail('envelope version');
  const h = m.get(7n);
  if (!Array.isArray(h) || h.length !== 2) return fail('envelope clock');
  const blob = m.get(10n);
  if (!(blob instanceof Uint8Array) || blob.length < 28) return fail('envelope blob');
  return {
    v: 1, fold: bytes(m.get(2n), 'envelope', 16), op: bytes(m.get(3n), 'envelope', 16), rec: bytes(m.get(4n), 'envelope', 16), dev: bytes(m.get(5n), 'envelope', 16),
    seq: u64(m.get(6n), 'envelope'), hlc: { wallMs: uint(h[0], 'envelope clock', 0xffff_ffff_ffffn), ctr: uint(h[1], 'envelope clock', 0xffffn) },
    epoch: uint(m.get(8n), 'envelope', 0xffff_ffffn), schema: uint(m.get(9n), 'envelope', 0xffffn), blob, sig: bytes(m.get(11n), 'envelope', 64),
  };
}

export function encodeOpEnvelopeWire(e: OpEnvelopeWire): Uint8Array {
  return encode(new Map<bigint, unknown>([
    [1n, 1], [2n, e.fold], [3n, e.op], [4n, e.rec], [5n, e.dev], [6n, e.seq], [7n, [e.hlc.wallMs, e.hlc.ctr]], [8n, e.epoch], [9n, e.schema], [10n, e.blob], [11n, e.sig],
  ]) as never);
}

// ---------------------------------------------------------------- Fold-key grant

export interface FoldKeyGrantWire {
  readonly fold: Bytes;
  readonly epoch: number;
  readonly member: Bytes;
  readonly role: number;
  readonly enc: Bytes;
  readonly ct: Bytes;
  readonly granted_by: Bytes;
  readonly sig: Bytes;
}

export function decodeFoldKeyGrantWire(input: Bytes): FoldKeyGrantWire {
  const m = decode(input);
  if (!(m instanceof Map)) return fail('grant');
  exactKeys(m, ['fold', 'epoch', 'member', 'role', 'enc', 'ct', 'granted_by', 'sig'], 'grant');
  const role = m.get('role');
  if (role !== 1n && role !== 2n && role !== 3n) fail('grant role');
  return {
    fold: bytes(m.get('fold'), 'grant', 16), epoch: uint(m.get('epoch'), 'grant', 0xffff_ffffn), member: bytes(m.get('member'), 'grant'), role: Number(role),
    enc: bytes(m.get('enc'), 'grant', 32), ct: bytes(m.get('ct'), 'grant', 48), granted_by: bytes(m.get('granted_by'), 'grant'), sig: bytes(m.get('sig'), 'grant', 64),
  };
}

export function encodeFoldKeyGrantWire(g: FoldKeyGrantWire): Uint8Array {
  return encode({ fold: g.fold, epoch: g.epoch, member: g.member, role: g.role, enc: g.enc, ct: g.ct, granted_by: g.granted_by, sig: g.sig } as never);
}

// ---------------------------------------------------------------- personal key set

export interface KeySetWire {
  readonly v: 1;
  readonly uuid: Bytes;
  readonly enc: { readonly alg: 'HPKE-X25519-HKDF-SHA256-AES256GCM'; readonly pk: Bytes; readonly sk_ct: Bytes };
  readonly sig: { readonly alg: 'Ed25519'; readonly pk: Bytes; readonly sk_ct: Bytes };
  readonly kdf:
    | { readonly kdf: 'argon2id'; readonly m_kib: number; readonly t: number; readonly p: number; readonly v: 19; readonly enc_salt: Bytes }
    | { readonly kdf: 'pbkdf2-hmac-sha256'; readonly iter: number; readonly enc_salt: Bytes };
  readonly encrypted_by: 'mp';
}

const range = (v: unknown, what: string, min: bigint, max: bigint): number => (typeof v === 'bigint' && v >= min && v <= max ? Number(v) : fail(what));
const ct = (v: unknown): Bytes => (v instanceof Uint8Array && v.length >= 28 ? v : fail('key set'));

export function decodeKeySetWire(input: Bytes): KeySetWire {
  const m = decode(input);
  if (!(m instanceof Map)) return fail('key set');
  exactKeys(m, ['v', 'uuid', 'enc', 'sig', 'kdf', 'encrypted_by'], 'key set');
  if (m.get('v') !== 1n || m.get('encrypted_by') !== 'mp') fail('key set');
  const [enc, sig, kdf] = [m.get('enc'), m.get('sig'), m.get('kdf')];
  if (!(enc instanceof Map) || !(sig instanceof Map) || !(kdf instanceof Map)) return fail('key set');
  exactKeys(enc, ['alg', 'pk', 'sk_ct'], 'key set');
  exactKeys(sig, ['alg', 'pk', 'sk_ct'], 'key set');
  if (enc.get('alg') !== 'HPKE-X25519-HKDF-SHA256-AES256GCM' || sig.get('alg') !== 'Ed25519') fail('key set');
  const base = {
    v: 1 as const, uuid: bytes(m.get('uuid'), 'key set', 16), encrypted_by: 'mp' as const,
    enc: { alg: 'HPKE-X25519-HKDF-SHA256-AES256GCM' as const, pk: bytes(enc.get('pk'), 'key set', 32), sk_ct: ct(enc.get('sk_ct')) },
    sig: { alg: 'Ed25519' as const, pk: bytes(sig.get('pk'), 'key set', 32), sk_ct: ct(sig.get('sk_ct')) },
  };
  if (kdf.get('kdf') === 'argon2id') {
    exactKeys(kdf, ['kdf', 'm_kib', 't', 'p', 'v', 'enc_salt'], 'key set');
    if (kdf.get('v') !== 19n) fail('key set');
    return {
      ...base,
      kdf: {
        kdf: 'argon2id', m_kib: range(kdf.get('m_kib'), 'key set', 32_768n, 0xffff_ffffn), t: range(kdf.get('t'), 'key set', 2n, 255n), p: range(kdf.get('p'), 'key set', 1n, 255n),
        v: 19, enc_salt: bytes(kdf.get('enc_salt'), 'key set', 16),
      },
    };
  }
  if (kdf.get('kdf') === 'pbkdf2-hmac-sha256') {
    exactKeys(kdf, ['kdf', 'iter', 'enc_salt'], 'key set');
    return { ...base, kdf: { kdf: 'pbkdf2-hmac-sha256', iter: range(kdf.get('iter'), 'key set', 600_000n, 0xffff_ffffn), enc_salt: bytes(kdf.get('enc_salt'), 'key set', 16) } };
  }
  return fail('key set');
}
