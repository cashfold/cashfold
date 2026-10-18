import { argon2id } from 'hash-wasm';
import { KdfBelowFloor, type Kdf } from '../../ports/index';
import { SecretBuf } from '../../secret-buf';

export const ARGON2_MIN_MEMORY_KIB = 32_768;
export const ARGON2_MIN_PASSES = 2;
export const ARGON2_MIN_PARALLELISM = 1;
const OUTPUT_BYTES = 32;

export interface Argon2Input {
  readonly password: Uint8Array;
  readonly salt: Uint8Array;
  readonly mKib: number;
  readonly t: number;
  readonly p: number;
  readonly length: number;
}

/** Unchecked primitive (version 0x13) for known-answer and differential tests. Production code uses `createArgon2Kdf`. */
export async function argon2idRaw({ password, salt, mKib, t, p, length }: Argon2Input): Promise<Uint8Array> {
  return argon2id({ password, salt, memorySize: mKib, iterations: t, parallelism: p, hashLength: length, outputType: 'binary' });
}

export function createArgon2Kdf(): Kdf {
  return {
    async derive(password: SecretBuf, salt: Uint8Array, params) {
      if (params.kdf !== 'argon2id') throw new Error('not an Argon2id parameter set');
      if (!(params.mKib >= ARGON2_MIN_MEMORY_KIB)) throw new KdfBelowFloor(`m ${params.mKib} KiB < ${ARGON2_MIN_MEMORY_KIB}`);
      if (!(params.t >= ARGON2_MIN_PASSES)) throw new KdfBelowFloor(`t ${params.t} < ${ARGON2_MIN_PASSES}`);
      if (!(params.p >= ARGON2_MIN_PARALLELISM)) throw new KdfBelowFloor(`p ${params.p} < ${ARGON2_MIN_PARALLELISM}`);
      const out = await password.use((pw) => argon2idRaw({ password: pw, salt, mKib: params.mKib, t: params.t, p: params.p, length: OUTPUT_BYTES }));
      return SecretBuf.take(out);
    },
  };
}
