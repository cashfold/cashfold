import { createDiffieHellman, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { G, N, N_BUF, N_BYTES, pad, unpad } from './group.js';

// The server side of SRP-6a (ARCH 6.3, 6.9). Secret exponents (the per-exchange `b`) are used only inside OpenSSL's
// constant-time Montgomery code through Node's Diffie-Hellman API: `g^b` by generateKeys() with the private key set,
// and `(A * v^u)^b` by computeSecret(). Everything done with `bigint` is on public values (A, B, v, u, k).
// The DH object checks the prime once, at start-up, and is reused: all calls are synchronous, so exchanges never interleave.

const dh = createDiffieHellman(N_BUF, Buffer.from([2]));

export type Hash = (data: Uint8Array) => Uint8Array;
const sha256: Hash = (data) => createHash('sha256').update(data).digest();

export type FinishResult =
  | { readonly ok: true; readonly M2: Buffer; readonly key: Buffer; readonly u: Buffer; readonly transcript: Buffer }
  | { readonly ok: false };

export interface Exchange {
  /** The server's public value, 512 bytes. */
  readonly B: Buffer;
  /** Verifies the client's proof. Single use: a second call, or a failed first call, always answers `{ ok: false }`. */
  finish(args: { accountId: string; authSalt: Uint8Array; M1: Uint8Array }): FinishResult;
}

export interface SrpServer {
  /** `g^secret mod N` through OpenSSL: the verifier for a secret exponent. Used for the stand-in verifier of unknown accounts. */
  verifierFrom(secret: Uint8Array): Buffer;
  /** Returns undefined for any malformed or degenerate input, so the caller can answer all of them identically. */
  begin(args: { v: Uint8Array; A: Uint8Array; b?: Uint8Array }): Exchange | undefined;
}

const cat = (...parts: Uint8Array[]): Buffer => Buffer.concat(parts);
const xor = (p: Uint8Array, q: Uint8Array): Buffer => Buffer.from(p.map((byte, i) => byte ^ q[i]!));

export function createSrpServer({ hash = sha256 }: { hash?: Hash } = {}): SrpServer {
  const H = (...parts: Uint8Array[]): Buffer => Buffer.from(hash(cat(...parts)));
  const NB = pad(N);
  const GB = pad(G);
  const k = unpad(H(NB, GB));
  const groupXor = xor(H(NB), H(GB));

  return {
    verifierFrom(secret) {
      dh.setPrivateKey(Buffer.from(secret));
      dh.generateKeys();
      return pad(unpad(dh.getPublicKey()));
    },
    begin({ v, A, b }) {
      if (v.length !== N_BYTES || A.length !== N_BYTES) return undefined;
      const AInt = unpad(A);
      const vInt = unpad(v);
      if (AInt % N === 0n || vInt % N === 0n) return undefined;

      const secret = Buffer.from(b ?? randomBytes(32));
      dh.setPrivateKey(secret);
      dh.generateKeys(); // keeps the private key above and computes g^b
      const gb = unpad(dh.getPublicKey());
      const BInt = (k * vInt + gb) % N;
      if (BInt === 0n) {
        secret.fill(0);
        return undefined;
      }
      const B = pad(BInt);
      const u = H(A, B);
      let spent = false;

      return {
        B,
        finish({ accountId, authSalt, M1 }) {
          if (spent) return { ok: false };
          spent = true;
          try {
            const uInt = unpad(u);
            if (uInt === 0n) return { ok: false };
            // S = (A * v^u)^b. The base is public; only the exponent b is secret, and OpenSSL handles that.
            const base = (AInt * modPowPublic(vInt, uInt)) % N;
            if (base <= 1n || base >= N - 1n) return { ok: false };
            dh.setPrivateKey(secret);
            const S = pad(unpad(dh.computeSecret(pad(base))));
            const K = H(S);
            const expected = H(groupXor, H(Buffer.from(accountId)), authSalt, A, B, K);
            const given = Buffer.from(M1);
            // One comparison, over buffers of equal length (a wrong-length M1 is compared against itself and then refused).
            const same = given.length === expected.length && timingSafeEqual(given, expected);
            if (!same) return { ok: false };
            return { ok: true, M2: H(A, expected, K), key: K, u: Buffer.from(u), transcript: H(A, B) };
          } catch {
            return { ok: false };
          } finally {
            secret.fill(0);
          }
        },
      };
    },
  };
}

/** `base^exp mod N` for public base and exponent (the verifier and the scrambling parameter), by square-and-multiply. */
function modPowPublic(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = base % N;
  for (let e = exp; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * b) % N;
    b = (b * b) % N;
  }
  return result;
}
