import { createDiffieHellman, randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { G, N, N_HEX, padGroup, unpadGroup } from '../../pake/group';
import { loadSrpBigint, SrpWasmError, type SrpBigint } from './index';
import { SRP_BIGINT_SHA256 } from './pinned';

const here = import.meta.dirname;
const wasm = new Uint8Array(readFileSync(resolve(here, 'srp-bigint.wasm')));
const pinned = readFileSync(resolve(here, 'srp-bigint.wasm.sha256'), 'utf8').trim();

/** Square-and-multiply with native bigint: obviously correct, variable-time, used only as a reference. */
function ref(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  for (let e = exp; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
  }
  return result;
}
const rand = (bytes: number): bigint => BigInt(`0x${randomBytes(bytes).toString('hex')}`);
const NB = padGroup(N);

let bn: SrpBigint;
beforeAll(async () => {
  bn = await loadSrpBigint(wasm, pinned);
});

describe('the pinned WASM artifact', () => {
  it('has the SHA-256 recorded next to it, and the loader refuses any other bytes', async () => {
    expect(createHash('sha256').update(wasm).digest('hex')).toBe(pinned);
    const tampered = Uint8Array.from(wasm);
    tampered[tampered.length - 1] = tampered.at(-1)! ^ 1;
    await expect(loadSrpBigint(tampered, pinned)).rejects.toMatchObject({ kind: 'hash_mismatch' });
  });

  it('imports nothing, so it cannot reach anything outside its own memory', async () => {
    const module = await WebAssembly.compile(wasm as BufferSource);
    expect(WebAssembly.Module.imports(module)).toEqual([]);
    expect(WebAssembly.Module.exports(module).map((e) => e.name).sort()).toEqual(['cf_alloc', 'cf_exp_sum', 'cf_free', 'cf_modpow', 'memory']);
  });

  it('refuses a module that lacks the expected exports', async () => {
    const empty = Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0);
    await expect(loadSrpBigint(empty, createHash('sha256').update(empty).digest('hex'))).rejects.toBeInstanceOf(SrpWasmError);
  });
});

describe('modpow agrees with a reference on the RFC 3526 group', () => {
  const pow = (b: bigint, e: bigint, bits = 4096) => unpadGroup(bn.modpow(padGroup(b), padGroup(e), bits, NB));

  it('handles the edge cases', () => {
    expect(pow(G, 0n, 1)).toBe(1n);
    expect(pow(G, 1n)).toBe(2n);
    expect(pow(0n, 5n)).toBe(0n);
    expect(pow(1n, rand(32))).toBe(1n);
    expect(pow(N - 1n, 2n)).toBe(1n);
    expect(pow(N - 1n, 3n)).toBe(N - 1n);
    expect(pow(G, (N - 1n) / 2n)).toBe(ref(G, (N - 1n) / 2n, N)); // a Legendre symbol: 1 or N-1
    expect(pow(G, N - 1n)).toBe(1n); // Fermat
  });

  it('matches for random bases and 256-bit, 512-bit and full-width exponents', () => {
    for (const [bytes, bits] of [[32, 256], [64, 512], [512, 4096]] as const) {
      for (let i = 0; i < 4; i++) {
        const base = rand(512) % N;
        const exp = rand(bytes);
        expect(pow(base, exp, bits)).toBe(ref(base, exp, N));
      }
    }
  });

  it('matches OpenSSL (Diffie-Hellman over the same prime) for 50 random secret exponents', () => {
    const dh = createDiffieHellman(Buffer.from(N_HEX, 'hex'), Buffer.from([2])); // OpenSSL checks the prime once, here
    for (let i = 0; i < 50; i++) {
      const secret = randomBytes(32);
      dh.setPrivateKey(secret);
      dh.generateKeys(); // keeps the private key set above, computes g^secret
      const secretInt = BigInt(`0x${secret.toString('hex')}`);
      expect(pow(G, secretInt, 256)).toBe(BigInt(`0x${dh.getPublicKey('hex')}`));
      const peer = rand(512) % (N - 2n) + 2n;
      const shared = dh.computeSecret(Buffer.from(padGroup(peer)));
      expect(pow(peer, secretInt, 256)).toBe(BigInt(`0x${shared.toString('hex')}`));
    }
  }, 120_000);

  it('refuses exponents wider than the stated bound being silently truncated is the caller\'s job: a bound is a bound', () => {
    // exp = 2^300 with a 256-bit bound uses only the low 256 bits, which are zero: the result is 1.
    expect(pow(G, 1n << 300n, 256)).toBe(1n);
  });

  it('rejects an even modulus, a bad bound and a buffer of the wrong size', () => {
    expect(() => bn.modpow(padGroup(3n), padGroup(5n), 256, padGroup(N - 1n))).toThrow(SrpWasmError);
    expect(() => bn.modpow(padGroup(3n), padGroup(5n), 0, NB)).toThrow(SrpWasmError);
    expect(() => bn.modpow(padGroup(3n), padGroup(5n), 4097, NB)).toThrow(SrpWasmError);
    expect(() => bn.modpow(new Uint8Array(511), padGroup(5n), 256, NB)).toThrow(SrpWasmError);
  });

  it('does not change its inputs', () => {
    const [b, e] = [padGroup(rand(64)), padGroup(rand(32))];
    const [b0, e0] = [Uint8Array.from(b), Uint8Array.from(e)];
    bn.modpow(b, e, 256, NB);
    expect(b).toEqual(b0);
    expect(e).toEqual(e0);
  });
});

describe('expSum computes a + u * x', () => {
  it('matches bigint for random 256-bit inputs and the largest ones', () => {
    for (let i = 0; i < 100; i++) {
      const [a, u, x] = [rand(32), rand(32), rand(32)];
      expect(unpadGroup(bn.expSum(padGroup(a), padGroup(u), padGroup(x)))).toBe(a + u * x);
    }
    const max = (1n << 256n) - 1n;
    expect(unpadGroup(bn.expSum(padGroup(max), padGroup(max), padGroup(max)))).toBe(max + max * max);
  });
});

describe('timing does not depend on the exponent', () => {
  it('takes about as long for a one-bit exponent as for a full one of the same width', () => {
    const base = padGroup(rand(512) % N);
    const run = (exp: Uint8Array): number => {
      const times: number[] = [];
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now();
        bn.modpow(base, exp, 256, NB);
        times.push(performance.now() - t0);
      }
      return times.sort((p, q) => p - q)[3]!;
    };
    const sparse = run(padGroup(1n));
    const dense = run(padGroup((1n << 256n) - 1n));
    // Square-and-multiply with branches would make `dense` roughly 1.5 times `sparse`; a fixed schedule makes them equal.
    expect(dense / sparse).toBeGreaterThan(0.7);
    expect(dense / sparse).toBeLessThan(1.3);
  });
});

describe('pinned hash constant', () => {
  it('is the hash of the committed module and of the .sha256 file beside it', () => {
    expect(createHash('sha256').update(wasm).digest('hex')).toBe(SRP_BIGINT_SHA256);
    expect(pinned).toBe(SRP_BIGINT_SHA256);
  });
});
