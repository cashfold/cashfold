import { ed25519 } from '@noble/curves/ed25519.js';
import type { Signer } from '../../ports/index.js';
import { SecretBuf } from '../../secret-buf.js';

/** Ed25519 over @noble/curves. Verification follows RFC 8032 (strict: canonical S, no ZIP-215 leniency). */
export function createEd25519Signer(): Signer {
  return {
    async generate(rng) {
      const secret = SecretBuf.take(Uint8Array.from(rng.bytes(32)));
      return { secretKey: secret, publicKey: secret.use((sk) => ed25519.getPublicKey(sk)) };
    },
    async publicKey(secretKey) {
      return secretKey.use((sk) => ed25519.getPublicKey(sk));
    },
    async sign(secretKey, message) {
      return secretKey.use((sk) => ed25519.sign(message, sk));
    },
    async verify(publicKey, message, signature) {
      if (publicKey.length !== 32 || signature.length !== 64) return false;
      try {
        return ed25519.verify(signature, message, publicKey, { zip215: false });
      } catch {
        return false;
      }
    },
  };
}

/**
 * Whether the runtime's WebCrypto supports Ed25519. Signing and verification stay on @noble/curves
 * regardless (one code path, strict RFC 8032 verification); this lets callers report capability
 * and lets a future adapter prefer the native implementation.
 */
export async function webCryptoEd25519Available(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}
