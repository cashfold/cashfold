import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSrpBigint, type SrpBigint } from '../adapters/srp-wasm/index';
import { SecretBuf } from '../secret-buf';
import { G, N, padGroup, unpadGroup } from './group';
import { sha256 } from '@noble/hashes/sha2.js';
import { createPake, type Pake } from './srp-client';

// FR-013. Known answers from an independent implementation (vectors/srp/reference.py, Python's pow and hashlib), negative
// vectors for every degenerate value, and 100 exchanges whose inputs and outputs were all computed independently.

const dir = resolve(import.meta.dirname, '../adapters/srp-wasm');
const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../vectors/srp/srp.json'), 'utf8')) as {
  group: { N: string; k: string };
  verifier: { account_id: string; auth_salt: string; k_p_srp: string; x: string; v: string };
  exchange: Record<string, string>;
  random: Array<Record<string, string>>;
};
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const num = (h: string) => BigInt(`0x${h}`);
const fromHex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
const secret32 = (hexText: string) => SecretBuf.from(fromHex(hexText).slice(-32));

let pake: Pake;
let bn: SrpBigint;
beforeAll(async () => {
  bn = await loadSrpBigint(new Uint8Array(readFileSync(resolve(dir, 'srp-bigint.wasm'))), readFileSync(resolve(dir, 'srp-bigint.wasm.sha256'), 'utf8'));
  pake = createPake({ bn, rng: { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) } });
});

describe('group parameters', () => {
  it('N and k match the independent reference', () => {
    expect(hex(padGroup(N))).toBe(vectors.group.N);
    expect(unpadGroup(pake.k)).toBe(num(vectors.group.k));
    expect(G).toBe(2n);
  });
});

describe('verifier', () => {
  it('v = g^x for the x derived by 2SKD, as the reference computes it', () => {
    expect(vectors.verifier.x.slice(-64)).toBe(vectors.verifier.k_p_srp);
    expect(hex(pake.verifier(secret32(vectors.verifier.x)))).toBe(vectors.verifier.v);
  });
});

describe('a fixed exchange', () => {
  const e = vectors.exchange;

  it('produces the same A, B-dependent values, K, M1 and M2 as the reference', () => {
    const session = pake.start(secret32(e['x']!), secret32(e['a']!));
    expect(hex(session.A)).toBe(e['A']);
    const done = session.respond({ accountId: e['account_id']!, authSalt: fromHex(e['auth_salt']!), B: fromHex(e['B']!) });
    expect(unpadGroup(done.u)).toBe(num(e['u']!));
    expect(hex(done.M1)).toBe(e['M1']);
    expect(done.key.use((k) => hex(k))).toBe(e['K']);
    expect(done.verify(fromHex(e['M2']!))).toBe(true);
  });

  it('rejects a wrong M2 and any single flipped bit of it', () => {
    const done = pake.start(secret32(e['x']!), secret32(e['a']!)).respond({ accountId: e['account_id']!, authSalt: fromHex(e['auth_salt']!), B: fromHex(e['B']!) });
    const good = fromHex(e['M2']!);
    for (const bit of [0, 7, 100, 255]) {
      const bad = Uint8Array.from(good);
      bad[bit >> 3] = bad[bit >> 3]! ^ (1 << (bit & 7));
      expect(done.verify(bad)).toBe(false);
    }
    expect(done.verify(good.slice(1))).toBe(false);
    expect(done.verify(new Uint8Array(32))).toBe(false);
  });

  it('binds the account and salt into M1', () => {
    const run = (accountId: string, salt: Uint8Array) => hex(pake.start(secret32(e['x']!), secret32(e['a']!)).respond({ accountId, authSalt: salt, B: fromHex(e['B']!) }).M1);
    expect(run(e['account_id']!, fromHex(e['auth_salt']!))).toBe(e['M1']);
    expect(run('ABCDEG', fromHex(e['auth_salt']!))).not.toBe(e['M1']);
    expect(run(e['account_id']!, new Uint8Array(16))).not.toBe(e['M1']);
  });
});

describe('100 independently computed exchanges', () => {
  it('agree on A, u, M1, K and M2 every time', () => {
    for (const r of vectors.random) {
      const session = pake.start(secret32(r['x']!), secret32(r['a']!));
      expect(hex(session.A), r['account_id']).toBe(r['A']);
      const done = session.respond({ accountId: r['account_id']!, authSalt: fromHex(r['auth_salt']!), B: fromHex(r['B']!) });
      expect(unpadGroup(done.u)).toBe(num(r['u']!));
      expect(hex(done.M1)).toBe(r['M1']);
      expect(done.key.use((k) => hex(k))).toBe(r['K']);
      expect(done.verify(fromHex(r['M2']!))).toBe(true);
    }
  }, 120_000);
});

describe('degenerate and malformed values are refused', () => {
  const e = vectors.exchange;
  const start = () => pake.start(secret32(e['x']!), secret32(e['a']!));
  const respond = (B: Uint8Array) => () => start().respond({ accountId: e['account_id']!, authSalt: fromHex(e['auth_salt']!), B });

  it('B = 0, B = N, and B such that B - k*v = 0', () => {
    expect(respond(padGroup(0n))).toThrowError(expect.objectContaining({ kind: 'degenerate_b' }) as never);
    expect(respond(padGroup(N))).toThrowError(expect.objectContaining({ kind: 'degenerate_b' }) as never);
    const kv = (unpadGroup(pake.k) * unpadGroup(fromHex(vectors.verifier.v))) % N;
    expect(respond(padGroup(kv))).toThrowError(expect.objectContaining({ kind: 'degenerate_b' }) as never);
  });

  it('truncated and oversized fields', () => {
    expect(respond(fromHex(e['B']!).slice(1))).toThrowError(expect.objectContaining({ kind: 'bad_length' }) as never);
    expect(respond(new Uint8Array(513))).toThrowError(expect.objectContaining({ kind: 'bad_length' }) as never);
    expect(() => start().respond({ accountId: e['account_id']!, authSalt: new Uint8Array(15), B: fromHex(e['B']!) })).toThrowError(expect.objectContaining({ kind: 'bad_length' }) as never);
  });

  it('u = 0', () => {
    const zeroU = createPake({ bn, rng: { bytes: (n) => new Uint8Array(n).fill(1) }, hash: (data) => (data.length === 1024 ? new Uint8Array(32) : sha(data)) });
    expect(() => zeroU.start(secret32(e['x']!), secret32(e['a']!)).respond({ accountId: e['account_id']!, authSalt: fromHex(e['auth_salt']!), B: fromHex(e['B']!) })).toThrowError(
      expect.objectContaining({ kind: 'degenerate_u' }) as never,
    );
  });

  it('an all-zero secret exponent (A = 1) is refused at the start', () => {
    expect(() => pake.start(secret32(e['x']!), SecretBuf.from(new Uint8Array(32)))).toThrowError(expect.objectContaining({ kind: 'degenerate_a' }) as never);
  });

  it('a session answers once', () => {
    const s = start();
    s.respond({ accountId: e['account_id']!, authSalt: fromHex(e['auth_salt']!), B: fromHex(e['B']!) });
    expect(() => s.respond({ accountId: e['account_id']!, authSalt: fromHex(e['auth_salt']!), B: fromHex(e['B']!) })).toThrowError(expect.objectContaining({ kind: 'state' }) as never);
  });

  it('wipes the secrets it was given when the session ends', () => {
    const x = secret32(e['x']!);
    const a = secret32(e['a']!);
    const s = pake.start(x, a);
    s.respond({ accountId: e['account_id']!, authSalt: fromHex(e['auth_salt']!), B: fromHex(e['B']!) }).key.wipe();
    s.wipe();
    expect(a.isWiped).toBe(true);
  });
});

const sha = (d: Uint8Array) => sha256(d);
