import { getDiffieHellman } from 'node:crypto';

// RFC 3526 section 5, the 4096-bit MODP group, as OpenSSL ships it. The client vendors the same constant and both are
// checked against the defining formula (packages/crypto/src/pake/group.test.ts); `group.test.ts` here pins this copy to
// the client's through the shared test vectors.

const prime = getDiffieHellman('modp16').getPrime();
export const N_BYTES = 512;
export const N_BUF: Buffer = prime;
export const N = BigInt(`0x${prime.toString('hex')}`);
export const G = 2n;

export function pad(value: bigint): Buffer {
  if (value < 0n || value >= 1n << 4096n) throw new RangeError('value does not fit in 512 bytes');
  const out = Buffer.alloc(N_BYTES);
  const hex = value.toString(16).padStart(N_BYTES * 2, '0');
  out.write(hex, 'hex');
  return out;
}

export const unpad = (bytes: Uint8Array): bigint => (bytes.length === 0 ? 0n : BigInt(`0x${Buffer.from(bytes).toString('hex')}`));
