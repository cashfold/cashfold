import type { Hkdf } from '../../ports/index';
import { SecretBuf } from '../../secret-buf';

const MAX_LENGTH = 255 * 32; // RFC 5869: L <= 255 * HashLen

export function createHkdf(): Hkdf {
  return {
    async derive(ikm, salt, info, length) {
      if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH) throw new RangeError('invalid HKDF output length');
      const base = await ikm.use((raw) => crypto.subtle.importKey('raw', raw as BufferSource, 'HKDF', false, ['deriveBits']));
      const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
        base,
        length * 8,
      );
      return SecretBuf.take(new Uint8Array(bits));
    },
  };
}
