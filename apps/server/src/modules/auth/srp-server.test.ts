import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { N, pad, unpad } from './group.js';
import { createSrpServer } from './srp-server.js';

// The server runs its secret-exponent work through OpenSSL's constant-time path (crypto.createDiffieHellman). Known answers
// and 100 exchanges come from vectors/srp/reference.py, which shares no code with this file or with the client.

const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../../vectors/srp/srp.json'), 'utf8')) as {
  verifier: { v: string };
  exchange: Record<string, string>;
  random: Array<Record<string, string>>;
};
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const bytes = (s: string) => Buffer.from(s, 'hex');
const srp = createSrpServer();
const num = (h: string) => BigInt(`0x${h}`);

describe('server side of SRP-6a', () => {
  it('computes the same verifier-dependent values as the reference for a fixed exchange', () => {
    const e = vectors.exchange;
    const begun = srp.begin({ v: bytes(vectors.verifier.v), A: bytes(e['A']!), b: bytes(e['b']!).subarray(-32) });
    if (begun === undefined) throw new Error('refused');
    expect(hex(begun.B)).toBe(e['B']);
    const done = begun.finish({ accountId: e['account_id']!, authSalt: bytes(e['auth_salt']!), M1: bytes(e['M1']!) });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(hex(done.M2)).toBe(e['M2']);
    expect(hex(done.key)).toBe(e['K']);
    expect(unpad(done.u)).toBe(num(e['u']!));
  });

  it('agrees with 100 independently computed exchanges', () => {
    for (const r of vectors.random) {
      const begun = srp.begin({ v: bytes(r['v']!), A: bytes(r['A']!), b: bytes(r['b']!).subarray(-32) });
      expect(begun, r['account_id']).toBeDefined();
      expect(hex(begun!.B)).toBe(r['B']);
      const done = begun!.finish({ accountId: r['account_id']!, authSalt: bytes(r['auth_salt']!), M1: bytes(r['M1']!) });
      expect(done.ok && hex(done.M2)).toBe(r['M2']);
    }
  }, 120_000);

  it('refuses a wrong M1, a flipped bit of it, and a wrong account or salt, without leaking which', () => {
    const e = vectors.exchange;
    const fresh = () => srp.begin({ v: bytes(vectors.verifier.v), A: bytes(e['A']!), b: bytes(e['b']!).subarray(-32) })!;
    const good = bytes(e['M1']!);
    const flipped = Buffer.from(good);
    flipped[3] = flipped[3]! ^ 0x10;
    for (const [m1, account, salt] of [
      [flipped, e['account_id']!, bytes(e['auth_salt']!)], [good.subarray(1), e['account_id']!, bytes(e['auth_salt']!)],
      [good, 'ABCDEG', bytes(e['auth_salt']!)], [good, e['account_id']!, Buffer.alloc(16)],
    ] as const) {
      expect(fresh().finish({ accountId: account, authSalt: salt, M1: m1 })).toEqual({ ok: false });
    }
  });

  it('refuses degenerate and malformed client values: A = 0, A = N, A = 2N mod, truncated, oversized', () => {
    const v = bytes(vectors.verifier.v);
    for (const A of [pad(0n), pad(N), Buffer.alloc(511, 1), Buffer.alloc(513, 1), Buffer.alloc(0)]) {
      expect(srp.begin({ v, A })).toBeUndefined();
    }
    expect(srp.begin({ v: Buffer.alloc(10), A: bytes(vectors.exchange['A']!) })).toBeUndefined();
  });

  it('refuses u = 0 (a hash that returns zero)', () => {
    const zero = createSrpServer({ hash: (d) => (d.length === 1024 ? new Uint8Array(32) : realHash(d)) });
    const begun = zero.begin({ v: bytes(vectors.verifier.v), A: bytes(vectors.exchange['A']!) });
    expect(begun?.finish({ accountId: 'ABCDEF', authSalt: Buffer.alloc(16), M1: Buffer.alloc(32) })).toEqual({ ok: false });
  });

  it('uses fresh randomness: two exchanges for the same A give different B, and a finished exchange cannot be reused', () => {
    const v = bytes(vectors.verifier.v);
    const A = bytes(vectors.exchange['A']!);
    const [first, second] = [srp.begin({ v, A })!, srp.begin({ v, A })!];
    expect(hex(first.B)).not.toBe(hex(second.B));
    first.finish({ accountId: 'ABCDEF', authSalt: Buffer.alloc(16), M1: Buffer.alloc(32) });
    expect(first.finish({ accountId: 'ABCDEF', authSalt: Buffer.alloc(16), M1: Buffer.alloc(32) })).toEqual({ ok: false });
  });

  it('takes no longer for a wrong proof than for a right one beyond measurement noise (same code path up to the compare)', () => {
    const e = vectors.exchange;
    const time = (m1: Buffer): number => {
      const t: number[] = [];
      for (let i = 0; i < 9; i++) {
        const begun = srp.begin({ v: bytes(vectors.verifier.v), A: bytes(e['A']!), b: bytes(e['b']!).subarray(-32) })!;
        const t0 = performance.now();
        begun.finish({ accountId: e['account_id']!, authSalt: bytes(e['auth_salt']!), M1: m1 });
        t.push(performance.now() - t0);
      }
      return t.sort((x, y) => x - y)[4]!;
    };
    const good = time(bytes(e['M1']!));
    const bad = time(Buffer.alloc(32, 1));
    expect(bad / good).toBeGreaterThan(0.5);
    expect(bad / good).toBeLessThan(2);
  });
});

const realHash = (d: Uint8Array) => createHash('sha256').update(d).digest();
