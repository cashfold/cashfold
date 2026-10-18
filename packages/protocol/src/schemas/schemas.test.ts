import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { decode, encode } from '../cbor/cbor.js';
import {
  decodeFoldKeyGrant, decodeFrame, decodeKeySet, decodeLogEntry, decodeOpEnvelope, decodeOpPayload, decodeSnapshot,
  encodeFoldKeyGrant, encodeFrame, encodeKeySet, encodeLogEntry, encodeOpEnvelope, encodeOpPayload, encodeSnapshot,
  opSigningBytes, type FieldValue, type FoldKeyGrant, type Frame, type KeySet, type LogEntry, type OpEnvelope, type OpPayload, type Snapshot,
} from './index.js';

const b = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

const envelope: OpEnvelope = {
  v: 1, fold: b(16, 1), op: b(16, 2), rec: b(16, 3), dev: b(16, 4), seq: 2n ** 40n, hlc: { wallMs: 1_700_000_000_000, ctr: 7 },
  epoch: 2, schema: 1, blob: b(300, 9), sig: b(64, 5),
};

describe('OpEnvelope', () => {
  it('round-trips', () => {
    expect(decodeOpEnvelope(encodeOpEnvelope(envelope))).toEqual(envelope);
  });

  it('encodes to integer-keyed canonical CBOR', () => {
    const map = decode(encodeOpEnvelope(envelope)) as Map<bigint, unknown>;
    expect([...map.keys()]).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 11n]);
  });

  it('signing bytes cover fields 1..10 under the domain label and exclude the signature', () => {
    const bytes = opSigningBytes(envelope);
    const label = new TextDecoder().decode(bytes.slice(0, 14));
    expect(label).toBe('cashfold.op.v1');
    const body = decode(bytes.slice(14)) as Map<bigint, unknown>;
    expect(body.has(11n)).toBe(false);
    expect(body.size).toBe(10);
    expect(opSigningBytes({ ...envelope, sig: b(64, 6) })).toEqual(bytes);
    expect(opSigningBytes({ ...envelope, epoch: 3 })).not.toEqual(bytes);
  });

  const mutate = (patch: (m: Map<bigint, unknown>) => void) => {
    const m = decode(encodeOpEnvelope(envelope)) as Map<bigint, unknown>;
    patch(m);
    return encode(m as never);
  };

  it.each([
    ['wrong version', (m: Map<bigint, unknown>) => m.set(1n, 2n)],
    ['short fold id', (m: Map<bigint, unknown>) => m.set(2n, b(15))],
    ['short signature', (m: Map<bigint, unknown>) => m.set(11n, b(63))],
    ['blob shorter than nonce+tag', (m: Map<bigint, unknown>) => m.set(10n, b(27))],
    ['u16 counter overflow', (m: Map<bigint, unknown>) => m.set(7n, [0n, 65536n])],
    ['u48 wall time overflow', (m: Map<bigint, unknown>) => m.set(7n, [2n ** 48n, 0n])],
    ['negative seq', (m: Map<bigint, unknown>) => m.set(6n, -1n)],
    ['epoch beyond u32', (m: Map<bigint, unknown>) => m.set(8n, 2n ** 32n)],
    ['unknown field', (m: Map<bigint, unknown>) => m.set(12n, 0n)],
    ['missing field', (m: Map<bigint, unknown>) => m.delete(5n)],
    ['text key', (m: Map<bigint, unknown>) => (m as unknown as Map<string, unknown>).set('x', 1n)],
  ])('rejects %s', (_name, patch) => {
    expect(() => decodeOpEnvelope(mutate(patch))).toThrow(ZodError);
  });

  it('rejects non-map input', () => {
    expect(() => decodeOpEnvelope(encode([1, 2]))).toThrow(ZodError);
  });
});

describe('OpPayload', () => {
  const payload: OpPayload = {
    t: 6,
    f: new Map<number, FieldValue>([
      [1, -12345n],
      [2, 'Coffee'],
      [3, b(16, 7)],
      [4, true],
      [5, null],
      [6, [1n, 'x', [2n]]],
      [7, { nested: 5n, deeper: { a: false } }],
      [65535, 1n],
    ]),
    fx: new Map([[9, { add: [b(16, 1)], rem: [[b(16, 2), b(16, 3)]] }]]),
  };

  it('round-trips with exact 64-bit integers', () => {
    const out = decodeOpPayload(encodeOpPayload(payload));
    expect(out.f?.get(1)).toBe(-12345n);
    expect(out).toEqual(payload);
  });

  it('accepts a payload with only a table code', () => {
    expect(decodeOpPayload(encodeOpPayload({ t: 1 }))).toEqual({ t: 1 });
  });

  it('rejects table codes outside 1..14', () => {
    for (const t of [0, 15]) expect(() => decodeOpPayload(encode({ t }))).toThrow(ZodError);
  });

  it('rejects integer field values outside i64', () => {
    for (const bad of [2n ** 63n, -(2n ** 63n) - 1n]) {
      expect(() => decodeOpPayload(encode({ t: 6, f: new Map([[1, bad]]) }))).toThrow(ZodError);
    }
    expect(() => decodeOpPayload(encode({ t: 6, f: new Map([[1, { deep: [2n ** 63n] }]]) }))).toThrow(ZodError);
  });

  it('rejects field ids beyond u16 and unknown payload keys', () => {
    expect(() => decodeOpPayload(encode({ t: 6, f: new Map([[65536, 1]]) }))).toThrow(ZodError);
    expect(() => decodeOpPayload(encode({ t: 6, extra: 1 }))).toThrow(ZodError);
  });

  it('rejects malformed set deltas', () => {
    expect(() => decodeOpPayload(encode({ t: 6, fx: new Map([[1, { add: [b(15)] }]]) }))).toThrow(ZodError);
    expect(() => decodeOpPayload(encode({ t: 6, fx: new Map([[1, { rem: [[b(16)]] }]]) }))).toThrow(ZodError);
  });
});

const keyset: KeySet = {
  v: 1, uuid: b(16, 1),
  enc: { alg: 'HPKE-X25519-HKDF-SHA256-AES256GCM', pk: b(32, 2), sk_ct: b(60, 3) },
  sig: { alg: 'Ed25519', pk: b(32, 4), sk_ct: b(60, 5) },
  kdf: { kdf: 'argon2id', m_kib: 65536, t: 3, p: 1, v: 19, enc_salt: b(16, 6) },
  encrypted_by: 'mp',
};

describe('KeySet', () => {
  it('round-trips Argon2id and PBKDF2 parameter sets', () => {
    expect(decodeKeySet(encodeKeySet(keyset))).toEqual(keyset);
    const pbkdf2: KeySet = { ...keyset, kdf: { kdf: 'pbkdf2-hmac-sha256', iter: 650_000, enc_salt: b(16, 6) } };
    expect(decodeKeySet(encodeKeySet(pbkdf2))).toEqual(pbkdf2);
  });

  it('enforces KDF floors on the wire (downgrade attempts are rejected)', () => {
    const weak = [
      { ...keyset, kdf: { ...keyset.kdf, m_kib: 32_767 } },
      { ...keyset, kdf: { ...keyset.kdf, t: 1 } },
      { ...keyset, kdf: { ...keyset.kdf, p: 0 } },
      { ...keyset, kdf: { kdf: 'pbkdf2-hmac-sha256', iter: 599_999, enc_salt: b(16) } },
    ];
    for (const k of weak) expect(() => decodeKeySet(encode(k as never))).toThrow(ZodError);
  });

  it('rejects wrong algorithms, key sizes and extra fields', () => {
    expect(() => decodeKeySet(encode({ ...keyset, encrypted_by: 'rk' } as never))).toThrow(ZodError);
    expect(() => decodeKeySet(encode({ ...keyset, enc: { ...keyset.enc, alg: 'RSA' } } as never))).toThrow(ZodError);
    expect(() => decodeKeySet(encode({ ...keyset, enc: { ...keyset.enc, pk: b(31) } } as never))).toThrow(ZodError);
    expect(() => decodeKeySet(encode({ ...keyset, extra: 1 } as never))).toThrow(ZodError);
  });
});

describe('FoldKeyGrant', () => {
  const grant: FoldKeyGrant = { fold: b(16), epoch: 3, member: b(20), role: 2, enc: b(32), ct: b(48), granted_by: b(20), sig: b(64) };
  it('round-trips and validates', () => {
    expect(decodeFoldKeyGrant(encodeFoldKeyGrant(grant))).toEqual(grant);
    expect(() => decodeFoldKeyGrant(encode({ ...grant, role: 4 } as never))).toThrow(ZodError);
    expect(() => decodeFoldKeyGrant(encode({ ...grant, ct: b(47) } as never))).toThrow(ZodError);
  });
});

describe('LogEntry', () => {
  const entry: LogEntry = { idx: 5n, prev: b(32), type: 'add_member', subject: b(20), role: 2, scope: 'from_join', from_epoch: 4, pubkeys: { enc: b(32), sig: b(32, 2) }, epoch: 4, signer: b(20), ts: 1_700_000_000_000n, sig: b(64) };
  it('round-trips with optional fields present and absent', () => {
    expect(decodeLogEntry(encodeLogEntry(entry))).toEqual(entry);
    const minimal: LogEntry = { idx: 0n, prev: b(32), type: 'leave', subject: b(20), signer: b(20), ts: 0n, sig: b(64) };
    expect(decodeLogEntry(encodeLogEntry(minimal))).toEqual(minimal);
  });
  it('rejects unknown types and scopes', () => {
    expect(() => decodeLogEntry(encode({ ...entry, type: 'promote' } as never))).toThrow(ZodError);
    expect(() => decodeLogEntry(encode({ ...entry, scope: 'some' } as never))).toThrow(ZodError);
    expect(() => decodeLogEntry(encode({ ...entry, prev: b(31) } as never))).toThrow(ZodError);
  });
});

describe('Snapshot and Frame', () => {
  it('round-trips a snapshot', () => {
    const s: Snapshot = { fold: b(16), at_seq: 10n, epoch: 1, blob: b(100), sig: b(64) };
    expect(decodeSnapshot(encodeSnapshot(s))).toEqual(s);
    expect(() => decodeSnapshot(encode({ ...s, sig: b(63) } as never))).toThrow(ZodError);
  });

  it('round-trips a frame and restricts direction to 0 or 1', () => {
    const f: Frame = { session: b(16), direction: 1, counter: 2n ** 63n, body: b(40) };
    expect(decodeFrame(encodeFrame(f))).toEqual(f);
    expect(() => decodeFrame(encodeFrame({ ...f, direction: 2 as never }))).toThrow(ZodError);
    expect(() => decodeFrame(encodeFrame({ ...f, session: b(15) }))).toThrow(ZodError);
  });
});
