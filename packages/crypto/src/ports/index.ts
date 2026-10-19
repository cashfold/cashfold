import type { SecretBuf } from '../secret-buf';

export type { SecretBuf };

export interface Rng {
  bytes(length: number): Uint8Array;
}

/** AES-256-GCM style AEAD. `sealed` is ciphertext || 128-bit tag. Nonce policy lives with the caller. */
export interface Aead {
  seal(key: SecretBuf, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  /** Rejects with `AeadError` when authentication fails. */
  open(key: SecretBuf, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
}

export class AeadError extends Error {
  constructor() {
    super('AEAD authentication failed');
    this.name = 'AeadError';
  }
}

export interface Hkdf {
  derive(ikm: SecretBuf, salt: Uint8Array, info: Uint8Array, length: number): Promise<SecretBuf>;
}

export type KdfParams =
  | { readonly kdf: 'argon2id'; readonly mKib: number; readonly t: number; readonly p: number }
  | { readonly kdf: 'pbkdf2-hmac-sha256'; readonly iterations: number };

/** Thrown when parameters are below the security floor (Argon2id m >= 32768 KiB, t >= 2, p >= 1; PBKDF2 >= 600000). */
export class KdfBelowFloor extends Error {
  constructor(detail: string) {
    super(`KDF parameters below floor: ${detail}`);
    this.name = 'KdfBelowFloor';
  }
}

export interface Kdf {
  /** Derives a 32-byte key. Wipe-after-use of `password` is the caller's job. */
  derive(password: SecretBuf, salt: Uint8Array, params: KdfParams): Promise<SecretBuf>;
}

export interface KeyPair {
  readonly publicKey: Uint8Array;
  readonly secretKey: SecretBuf;
}

export interface Signer {
  generate(rng: Rng): Promise<KeyPair>;
  publicKey(secretKey: SecretBuf): Promise<Uint8Array>;
  sign(secretKey: SecretBuf, message: Uint8Array): Promise<Uint8Array>;
  /** Strict verification: malformed or non-canonical signatures return false, never throw. */
  verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean>;
}

export interface Hpke {
  generate(rng: Rng): Promise<KeyPair>;
  seal(args: { recipientPublicKey: Uint8Array; info: Uint8Array; aad: Uint8Array; plaintext: Uint8Array; rng: Rng }): Promise<{ enc: Uint8Array; ct: Uint8Array }>;
  open(args: { recipientSecretKey: SecretBuf; enc: Uint8Array; info: Uint8Array; aad: Uint8Array; ct: Uint8Array }): Promise<Uint8Array>;
}

