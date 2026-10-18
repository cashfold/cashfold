import { KdfBelowFloor, type Kdf } from '../../ports/index.js';
import { SecretBuf } from '../../secret-buf.js';

export const PBKDF2_MIN_ITERATIONS = 600_000;
const OUTPUT_BYTES = 32;

export interface Pbkdf2 extends Kdf {
  /** Unchecked primitive for known-answer tests. Production code must go through `derive`. */
  raw(password: SecretBuf, salt: Uint8Array, iterations: number, length: number): Promise<SecretBuf>;
}

export function createPbkdf2(): Pbkdf2 {
  const raw: Pbkdf2['raw'] = async (password, salt, iterations, length) => {
    const base = await password.use((p) => crypto.subtle.importKey('raw', p as BufferSource, 'PBKDF2', false, ['deriveBits']));
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
      base,
      length * 8,
    );
    return SecretBuf.take(new Uint8Array(bits));
  };
  return {
    raw,
    async derive(password, salt, params) {
      if (params.kdf !== 'pbkdf2-hmac-sha256') throw new Error('not a PBKDF2 parameter set');
      if (!Number.isInteger(params.iterations) || params.iterations < PBKDF2_MIN_ITERATIONS) {
        throw new KdfBelowFloor(`iterations ${params.iterations} < ${PBKDF2_MIN_ITERATIONS}`);
      }
      return raw(password, salt, params.iterations, OUTPUT_BYTES);
    },
  };
}
