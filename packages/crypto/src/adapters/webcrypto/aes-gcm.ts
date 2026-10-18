import { AeadError, type Aead } from '../../ports/index.js';
import type { SecretBuf } from '../../secret-buf.js';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BITS = 128;

async function importKey(key: SecretBuf, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  if (key.length !== KEY_BYTES) throw new RangeError('AES-256-GCM requires a 32-byte key');
  return key.use((raw) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [usage]));
}

function checkNonce(nonce: Uint8Array): void {
  if (nonce.length !== NONCE_BYTES) throw new RangeError('AES-GCM requires a 12-byte nonce');
}

/** AES-256-GCM over WebCrypto: 96-bit nonce, 128-bit tag, non-extractable imported keys. */
export function createAesGcm(): Aead {
  return {
    async seal(key, nonce, plaintext, aad) {
      checkNonce(nonce);
      const k = await importKey(key, 'encrypt');
      const params = { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: TAG_BITS };
      return new Uint8Array(await crypto.subtle.encrypt(params, k, plaintext as BufferSource));
    },
    async open(key, nonce, sealed, aad) {
      checkNonce(nonce);
      const k = await importKey(key, 'decrypt');
      const params = { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: TAG_BITS };
      try {
        return new Uint8Array(await crypto.subtle.decrypt(params, k, sealed as BufferSource));
      } catch {
        throw new AeadError();
      }
    },
  };
}
