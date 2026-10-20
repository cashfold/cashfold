import { checkPrime, getDiffieHellman } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { G, N, N_BYTES, N_HEX, padGroup } from './group';

// FR-013: the SRP group is RFC 3526 section 5 (4096-bit MODP). The constant is checked here against the defining formula,
// against an independent copy (OpenSSL's own table), and for the safe-prime property. Nothing here trusts the vendored hex.

/** floor(pi * 2^bits) by Machin's formula, in exact integer arithmetic. */
function piScaled(bits: number): bigint {
  const guard = 64;
  const one = 1n << BigInt(bits + guard);
  const arctanInv = (x: bigint): bigint => {
    let term = one / x;
    let sum = term;
    const x2 = x * x;
    for (let n = 1n; term !== 0n; n++) {
      term /= x2;
      sum += (n % 2n === 1n ? -1n : 1n) * (term / (2n * n + 1n));
    }
    return sum;
  };
  return (16n * arctanInv(5n) - 4n * arctanInv(239n)) >> BigInt(guard);
}

const isPrime = (n: bigint): Promise<boolean> => new Promise((resolve, reject) => checkPrime(n, { checks: 40 }, (e, ok) => (e ? reject(e) : resolve(ok))));

describe('the RFC 3526 4096-bit group', () => {
  it('equals 2^4096 - 2^4032 - 1 + 2^64 * (floor(2^3966 * pi) + 240904)', () => {
    const formula = 2n ** 4096n - 2n ** 4032n - 1n + 2n ** 64n * (piScaled(3966) + 240_904n);
    expect(N).toBe(formula);
  });

  it('matches the copy OpenSSL ships as modp16', () => {
    expect(N).toBe(BigInt(`0x${getDiffieHellman('modp16').getPrime().toString('hex')}`));
    expect(getDiffieHellman('modp16').getGenerator().toString('hex')).toBe('02');
  });

  it('is a 4096-bit safe prime with generator 2', async () => {
    expect(N.toString(2)).toHaveLength(4096);
    expect(G).toBe(2n);
    expect(await isPrime(N)).toBe(true);
    expect(await isPrime((N - 1n) / 2n)).toBe(true);
  }, 120_000);

  it('is exposed as 512 bytes and as hex without drift', () => {
    expect(N_BYTES).toBe(512);
    expect(BigInt(`0x${N_HEX}`)).toBe(N);
    expect(N_HEX).toMatch(/^[0-9a-f]{1024}$/);
  });

  it('pads to 512 bytes big-endian and refuses what does not fit', () => {
    expect(padGroup(1n)).toHaveLength(512);
    expect(padGroup(1n)[511]).toBe(1);
    expect(padGroup(0x0102n).slice(510)).toEqual(Uint8Array.of(1, 2));
    expect(padGroup(N - 1n)[0]).toBe(0xff);
    expect(() => padGroup(1n << 4096n)).toThrow(RangeError);
    expect(() => padGroup(-1n)).toThrow(RangeError);
  });
});
