import { x25519 as curve } from '@noble/curves/ed25519.js';
import { SecretBuf } from '../../secret-buf';

export function x25519PublicKey(secretKey: SecretBuf): Uint8Array {
  return secretKey.use((sk) => curve.getPublicKey(sk));
}

/** X25519 shared secret. Throws on low-order peer points (all-zero output), per RFC 7748 section 6.1. */
export function x25519(secretKey: SecretBuf, peerPublicKey: Uint8Array): SecretBuf {
  const shared = secretKey.use((sk) => curve.getSharedSecret(sk, peerPublicKey));
  if (shared.every((b) => b === 0)) throw new Error('X25519 produced an all-zero shared secret');
  return SecretBuf.take(shared);
}
