import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSrpBigint, type SrpBigint } from '../adapters/srp-wasm/index';
import { SecretBuf } from '../secret-buf';
import { N, padGroup } from './group';
import { createPake, SrpError, type Pake } from './srp-client';

// Fuzzing the SRP client and the WebAssembly big-integer module (T191). The module does constant-time arithmetic on secret exponents,
// so its answers are checked against JavaScript's own bigint on random operands; a wrong answer anywhere would be a wrong key.
// (Coverage-guided fuzzing of the compiled module needs a fuzzing engine such as Jazzer.js or cargo-fuzz.
// These properties exercise the same inputs through the public interface.)

const dir = resolve(import.meta.dirname, '../adapters/srp-wasm');
let bn: SrpBigint;
let pake: Pake;
beforeAll(async () => {
  bn = await loadSrpBigint(new Uint8Array(readFileSync(resolve(dir, 'srp-bigint.wasm'))), readFileSync(resolve(dir, 'srp-bigint.wasm.sha256'), 'utf8'));
  pake = createPake({ bn, rng: { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) } });
});

const modpow = (b: bigint, e: bigint, m: bigint): bigint => {
  let r = 1n;
  b %= m;
  for (; e > 0n; e >>= 1n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
  }
  return r;
};
const big = (bits: number) => fc.bigInt({ min: 0n, max: (1n << BigInt(bits)) - 1n });

describe('the big-integer module agrees with JavaScript bigint', () => {
  it('modpow, for random bases below N and exponents of 1 to 256 bits', () => {
    fc.assert(fc.property(big(4095), fc.integer({ min: 1, max: 256 }).chain((bits) => fc.tuple(fc.constant(bits), big(bits))), (base, [bits, exp]) => {
      const b = base % N;
      expect(BigInt(`0x${Buffer.from(bn.modpow(padGroup(b), padGroup(exp), bits, padGroup(N))).toString('hex')}`)).toBe(modpow(b, exp, N));
    }), { numRuns: 300 });
  });

  it('modpow at the edges: 0, 1, N-1, exponent 0, 1 and all ones', () => {
    for (const b of [0n, 1n, 2n, N - 1n, N - 2n]) {
      for (const e of [0n, 1n, 2n, (1n << 256n) - 1n]) {
        expect(BigInt(`0x${Buffer.from(bn.modpow(padGroup(b), padGroup(e), 256, padGroup(N))).toString('hex')}`), `${b} ^ ${e}`).toBe(modpow(b, e, N));
      }
    }
  });

  it('a + u*x for 256-bit operands', () => {
    fc.assert(fc.property(big(256), big(256), big(256), (a, u, x) => {
      expect(BigInt(`0x${Buffer.from(bn.expSum(padGroup(a), padGroup(u), padGroup(x))).toString('hex')}`)).toBe(a + u * x);
    }), { numRuns: 500 });
  });

  it('refuses inputs of the wrong size instead of reading past them', () => {
    for (const len of [0, 1, 511, 513, 1024]) {
      const odd = new Uint8Array(len);
      expect(() => bn.modpow(odd, padGroup(1n), 8, padGroup(N))).toThrow();
      expect(() => bn.modpow(padGroup(2n), padGroup(1n), 8, odd)).toThrow();
      expect(() => bn.expSum(odd, padGroup(1n), padGroup(1n))).toThrow();
    }
  });
});

describe('the SRP client against a hostile server', () => {
  const secret = () => SecretBuf.from(new Uint8Array(32).fill(5));
  const respond = (B: Uint8Array) => pake.start(secret()).respond({ accountId: 'ABCDEF', authSalt: new Uint8Array(16).fill(1), B });

  it('refuses a public value that is zero modulo N, and any of the wrong length', () => {
    for (const B of [0n, N]) expect(() => respond(padGroup(B))).toThrow(SrpError); // 0 and N are both 0 modulo N (2N does not fit in 512 bytes)
    fc.assert(fc.property(fc.uint8Array({ maxLength: 700 }).filter((b) => b.length !== 512), (B) => {
      expect(() => respond(B)).toThrow(SrpError);
    }), { numRuns: 300 });
  });

  it('given any 512 bytes either refuses cleanly or answers with a 32-byte proof; never throws anything else', () => {
    fc.assert(fc.property(fc.uint8Array({ minLength: 512, maxLength: 512 }), (B) => {
      try {
        const r = respond(B);
        expect(r.M1).toHaveLength(32);
        expect(r.verify(new Uint8Array(32))).toBe(false); // a made-up server proof never verifies
        r.key.wipe();
      } catch (e) {
        expect(e).toBeInstanceOf(SrpError);
      }
    }), { numRuns: 200 });
  });
});
