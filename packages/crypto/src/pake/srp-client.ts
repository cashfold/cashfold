import { sha256 } from '@noble/hashes/sha2.js';
import type { SrpBigint } from '../adapters/srp-wasm/index';
import type { Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import { G, N, N_BYTES, padGroup, unpadGroup } from './group';

// The client side of SRP-6a over the 4096-bit RFC 3526 group (ARCH 6.1, 6.3). x comes from 2SKD (purpose "srp"), not
// from RFC 5054. Every operation with a secret exponent (a, x, a + u*x) runs in the constant-time WASM module; native
// `bigint` only ever sees public values (A, B, v, k, u, S's hash input is the module's output).

export type SrpErrorKind = 'bad_length' | 'degenerate_a' | 'degenerate_b' | 'degenerate_u' | 'state';

export class SrpError extends Error {
  constructor(readonly kind: SrpErrorKind) {
    super(`srp: ${kind}`);
    this.name = 'SrpError';
  }
}

export interface SrpResponse {
  readonly accountId: string;
  readonly authSalt: Uint8Array;
  readonly B: Uint8Array;
}

export interface SrpResult {
  readonly u: Uint8Array;
  readonly M1: Uint8Array;
  /** The session key K. The caller derives transport keys from it and wipes it. */
  readonly key: SecretBuf;
  /** `H(PAD(A) || PAD(B))`, the transcript the transport keys are bound to (ARCH 6.5). */
  readonly transcript: Uint8Array;
  /** Checks the server's proof M2 in constant time. */
  verify(M2: Uint8Array): boolean;
}

export interface SrpSession {
  readonly A: Uint8Array;
  respond(response: SrpResponse): SrpResult;
  /** Drops what is left of the secrets. */
  wipe(): void;
}

export interface Pake {
  /** `k = H(PAD(N) || PAD(g))`. */
  readonly k: Uint8Array;
  /** `v = g^x mod N` for registration: 512 bytes. */
  verifier(x: SecretBuf): Uint8Array;
  /** Begins an exchange. `a` is for tests that need fixed values; normally it is drawn from the RNG. */
  start(x: SecretBuf, a?: SecretBuf): SrpSession;
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const xor = (p: Uint8Array, q: Uint8Array): Uint8Array => p.map((b, i) => b ^ q[i]!);

/** Compares two byte strings in time that depends only on their length. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function createPake({ bn, rng, hash = sha256 }: { bn: SrpBigint; rng: Rng; hash?: (data: Uint8Array) => Uint8Array }): Pake {
  const NB = padGroup(N);
  const GB = padGroup(G);
  const H = (...parts: Uint8Array[]): Uint8Array => hash(cat(...parts));
  const k = H(NB, GB);
  const kInt = unpadGroup(k);
  const groupXor = xor(H(NB), H(GB));

  /** Secret exponents travel as 512-byte buffers that are zeroed after use. */
  const widen = (secret: SecretBuf): Uint8Array => {
    const out = new Uint8Array(N_BYTES);
    secret.use((b) => out.set(b, N_BYTES - b.length));
    return out;
  };

  return {
    k,
    verifier(x) {
      const xb = widen(x);
      try {
        return bn.modpow(GB, xb, 256, NB);
      } finally {
        xb.fill(0);
      }
    },
    start(x, a) {
      const secretA = a ?? SecretBuf.take(rng.bytes(32));
      const xb = widen(x);
      const ab = widen(secretA);
      let state: 'started' | 'answered' | 'wiped' = 'started';
      const wipeAll = () => {
        xb.fill(0);
        ab.fill(0);
        secretA.wipe();
        state = 'wiped';
      };
      let A: Uint8Array;
      try {
        A = bn.modpow(GB, ab, 256, NB);
      } catch (e) {
        wipeAll();
        throw e;
      }
      if (unpadGroup(A) % N === 0n || unpadGroup(A) === 1n) {
        wipeAll();
        throw new SrpError('degenerate_a');
      }
      const v = bn.modpow(GB, xb, 256, NB);
      const vInt = unpadGroup(v);

      return {
        A,
        respond({ accountId, authSalt, B }) {
          if (state !== 'started') throw new SrpError('state');
          state = 'answered';
          try {
            if (B.length !== N_BYTES || authSalt.length !== 16) throw new SrpError('bad_length');
            const BInt = unpadGroup(B);
            if (BInt % N === 0n) throw new SrpError('degenerate_b');
            const u = H(A, B);
            if (unpadGroup(u) === 0n) throw new SrpError('degenerate_u');
            // B - k*v is public (v is the verifier the server already holds); only the exponent a + u*x is secret.
            const base = (((BInt - kInt * vInt) % N) + N) % N;
            if (base === 0n) throw new SrpError('degenerate_b');
            const e = bn.expSum(ab, widenBytes(u), xb);
            const S = bn.modpow(padGroup(base), e, 513, NB);
            e.fill(0);
            const K = H(S);
            S.fill(0);
            const M1 = H(groupXor, H(text(accountId)), authSalt, A, B, K);
            const M2 = H(A, M1, K);
            return {
              u,
              M1,
              key: SecretBuf.take(K),
              transcript: H(A, B),
              verify: (given: Uint8Array) => constantTimeEqual(M2, given),
            };
          } finally {
            wipeAll();
          }
        },
        wipe: wipeAll,
      };
    },
  };
}

function widenBytes(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(N_BYTES);
  out.set(b, N_BYTES - b.length);
  return out;
}
