import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encode } from '../cbor/cbor';
import { decodeFoldKeyGrant, decodeKeySet, decodeOpEnvelope, encodeFoldKeyGrant, encodeKeySet, encodeOpEnvelope } from './index';
import { decodeFoldKeyGrantWire, decodeKeySetWire, decodeOpEnvelopeWire, encodeFoldKeyGrantWire, encodeOpEnvelopeWire } from './record-wire';

// The worker's decoders must accept and reject exactly what the zod schemas do, and produce the same values.

const b = (n: number, fill = 1) => new Uint8Array(n).fill(fill);
const accepts = (f: () => unknown): boolean => {
  try {
    f();
    return true;
  } catch {
    return false;
  }
};
const canon = (v: unknown): unknown =>
  typeof v === 'bigint' ? `${v}n` : v instanceof Uint8Array ? Array.from(v) : Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v;
const same = (a: unknown, c: unknown) => expect(canon(a)).toEqual(canon(c));

const envelope = { v: 1 as const, fold: b(16, 2), op: b(16, 3), rec: b(16, 4), dev: b(16, 5), seq: 7n, hlc: { wallMs: 1_700_000_000_000, ctr: 3 }, epoch: 2, schema: 1, blob: b(60, 9), sig: b(64, 8) };
const grant = { fold: b(16), epoch: 3, member: b(6, 65), role: 2 as const, enc: b(32), ct: b(48), granted_by: b(6, 66), sig: b(64) };
const keySet = {
  v: 1 as const, uuid: b(16), enc: { alg: 'HPKE-X25519-HKDF-SHA256-AES256GCM' as const, pk: b(32), sk_ct: b(60) }, sig: { alg: 'Ed25519' as const, pk: b(32), sk_ct: b(60) },
  kdf: { kdf: 'argon2id' as const, m_kib: 65_536, t: 3, p: 1, v: 19 as const, enc_salt: b(16) }, encrypted_by: 'mp' as const,
};

/** Flips one byte of the encoding at a random place, or cuts it short. */
const mutate = (bytes: Uint8Array, at: number, how: number): Uint8Array => {
  const out = Uint8Array.from(bytes);
  if (how % 3 === 0) return out.slice(0, at % out.length);
  out[at % out.length] = out[at % out.length]! ^ (1 << (how % 8));
  return out;
};

describe('op envelope', () => {
  it('reads what the schema reads and writes what it writes', () => {
    const bytes = encodeOpEnvelope(envelope);
    same(decodeOpEnvelopeWire(bytes), decodeOpEnvelope(bytes));
    expect(encodeOpEnvelopeWire(envelope)).toEqual(bytes);
  });
  it('agrees with the schema on arbitrary damage', () => {
    const bytes = encodeOpEnvelope(envelope);
    fc.assert(fc.property(fc.nat(500), fc.nat(1000), (at, how) => {
      const m = mutate(bytes, at, how);
      expect(accepts(() => decodeOpEnvelopeWire(m))).toBe(accepts(() => decodeOpEnvelope(m)));
    }), { numRuns: 400 });
  });
  it('rejects the usual wrong shapes', () => {
    for (const bad of [{ ...envelope, blob: b(27) }, { ...envelope, sig: b(63) }, { ...envelope, fold: b(15) }]) {
      const bytes = encode(new Map<bigint, unknown>([[1n, 1], [2n, bad.fold], [3n, bad.op], [4n, bad.rec], [5n, bad.dev], [6n, bad.seq], [7n, [bad.hlc.wallMs, bad.hlc.ctr]], [8n, bad.epoch], [9n, bad.schema], [10n, bad.blob], [11n, bad.sig]]) as never);
      expect(accepts(() => decodeOpEnvelopeWire(bytes))).toBe(false);
      expect(accepts(() => decodeOpEnvelope(bytes))).toBe(false);
    }
    expect(accepts(() => decodeOpEnvelopeWire(encode([1, 2] as never)))).toBe(false);
  });
});

describe('Fold-key grant', () => {
  it('reads what the schema reads and writes what it writes', () => {
    const bytes = encodeFoldKeyGrant(grant);
    same(decodeFoldKeyGrantWire(bytes), decodeFoldKeyGrant(bytes));
    expect(encodeFoldKeyGrantWire(grant)).toEqual(bytes);
  });
  it('agrees with the schema on arbitrary damage and on out-of-range fields', () => {
    const bytes = encodeFoldKeyGrant(grant);
    fc.assert(fc.property(fc.nat(500), fc.nat(1000), (at, how) => {
      const m = mutate(bytes, at, how);
      expect(accepts(() => decodeFoldKeyGrantWire(m))).toBe(accepts(() => decodeFoldKeyGrant(m)));
    }), { numRuns: 400 });
    for (const patch of [{ role: 4n }, { role: 0n }, { epoch: 2n ** 32n }, { ct: b(47) }, { enc: b(31) }]) {
      const bytes2 = encode({ ...grant, role: BigInt(grant.role), epoch: BigInt(grant.epoch), ...patch } as never);
      expect(accepts(() => decodeFoldKeyGrantWire(bytes2))).toBe(accepts(() => decodeFoldKeyGrant(bytes2)));
    }
  });
});

describe('key set', () => {
  it('reads what the schema reads', () => {
    const bytes = encodeKeySet(keySet);
    same(decodeKeySetWire(bytes), decodeKeySet(bytes));
    const pbkdf2 = encodeKeySet({ ...keySet, kdf: { kdf: 'pbkdf2-hmac-sha256', iter: 600_000, enc_salt: b(16) } });
    same(decodeKeySetWire(pbkdf2), decodeKeySet(pbkdf2));
  });
  it('agrees with the schema on arbitrary damage, and on parameters below the floors', () => {
    const bytes = encodeKeySet(keySet);
    fc.assert(fc.property(fc.nat(800), fc.nat(1000), (at, how) => {
      const m = mutate(bytes, at, how);
      expect(accepts(() => decodeKeySetWire(m))).toBe(accepts(() => decodeKeySet(m)));
    }), { numRuns: 600 });
    for (const kdf of [{ ...keySet.kdf, m_kib: 1024 }, { ...keySet.kdf, t: 1 }, { ...keySet.kdf, p: 0 }, { kdf: 'pbkdf2-hmac-sha256', iter: 1000, enc_salt: b(16) }, { kdf: 'scrypt' }]) {
      const m = encode({ v: 1n, uuid: keySet.uuid, enc: keySet.enc, sig: keySet.sig, kdf: Object.fromEntries(Object.entries(kdf).map(([k, v]) => [k, typeof v === 'number' ? BigInt(v) : v])), encrypted_by: 'mp' } as never);
      expect(accepts(() => decodeKeySetWire(m))).toBe(accepts(() => decodeKeySet(m)));
      expect(accepts(() => decodeKeySetWire(m))).toBe(false);
    }
  });
});
