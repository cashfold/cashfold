import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256(server secret, lower(email)): how accounts are looked up, so the address itself is never an index. */
export const emailMac = (secret: Uint8Array, email: string): Buffer => createHmac('sha256', secret).update(`email:${email.trim().toLowerCase()}`).digest();

/**
 * The salt and key-derivation parameters shown for an address that has no account: derived from a keyed MAC of the address,
 * so the same unknown address always gets the same answer and it looks exactly like a real one (AUTH-4).
 */
export function fakeAccount(secret: Uint8Array, email: string, defaults: { mKib: number; t: number; p: number }) {
  const mac = (label: string) => createHmac('sha256', secret).update(`fake:${label}:${email.trim().toLowerCase()}`).digest();
  const id = mac('id');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return {
    accountId: Array.from({ length: 6 }, (_, i) => alphabet[id[i]! % alphabet.length]).join(''),
    authSalt: mac('auth_salt').subarray(0, 16),
    encSalt: mac('enc_salt').subarray(0, 16),
    kdf: { kdf: 'argon2id' as const, mKib: defaults.mKib, t: defaults.t, p: defaults.p },
    // A verifier no one knows the exponent of: unknowable, but a valid group element, so the exchange proceeds identically.
    verifierSeed: mac('verifier'),
  };
}

export const randomId = (n = 16): Buffer => randomBytes(n);

export function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
export const fromB64url = (s: string): Buffer => Buffer.from(s, 'base64url');
