import { decode, encode } from '@cashfold/protocol/cbor';
import type { Aead, Hkdf, Kdf, KdfParams, Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';

// An encrypted backup of one Fold (FR-091): AES-256-GCM under either a key stretched from a passphrase (Argon2id, with the same
// floors as everything else, checked before any derivation) or a key derived from the Fold key, for restoring on the same account.
//   file = CBOR { v: 1, mode: "pass" | "fk", kdf?: {...params, salt}, nonce, ct }
//   AAD  = "cashfold.backup.v1" || mode (|| Fold id for "fk")
// The file names no Fold and carries no plaintext.

export class BackupError extends Error {
  constructor(readonly code: 'malformed' | 'wrong_kind' | 'empty_passphrase') {
    super(`Backup rejected (${code})`);
    this.name = 'BackupError';
  }
}

export type BackupSecret =
  | { readonly kind: 'passphrase'; readonly passphrase: SecretBuf }
  | { readonly kind: 'foldKey'; readonly key: SecretBuf; readonly fold: Uint8Array };

export interface BackupCrypto {
  seal(plain: Uint8Array, secret: BackupSecret): Promise<Uint8Array>;
  /** Rejects with `AeadError` for a wrong secret or any change, `BackupError` for something that is not a backup of this kind. */
  open(file: Uint8Array, secret: BackupSecret): Promise<Uint8Array>;
}

const text = (s: string) => new TextEncoder().encode(s);
const aadFor = (mode: 'pass' | 'fk', fold?: Uint8Array) => Uint8Array.from([...text('cashfold.backup.v1'), ...text(mode), ...(fold ?? [])]);

const paramsToWire = (p: KdfParams): Record<string, unknown> =>
  p.kdf === 'argon2id' ? { kdf: p.kdf, m_kib: BigInt(p.mKib), t: BigInt(p.t), p: BigInt(p.p) } : { kdf: p.kdf, iter: BigInt(p.iterations) };

function paramsFromWire(m: unknown): KdfParams {
  if (!(m instanceof Map)) throw new BackupError('malformed');
  const kdf = m.get('kdf');
  if (kdf === 'argon2id' && typeof m.get('m_kib') === 'bigint' && typeof m.get('t') === 'bigint' && typeof m.get('p') === 'bigint') {
    return { kdf, mKib: Number(m.get('m_kib')), t: Number(m.get('t')), p: Number(m.get('p')) };
  }
  if (kdf === 'pbkdf2-hmac-sha256' && typeof m.get('iter') === 'bigint') return { kdf, iterations: Number(m.get('iter')) };
  throw new BackupError('malformed');
}

export function createBackupCrypto({ aead, hkdf, kdf, rng, defaultKdf }: { aead: Aead; hkdf: Hkdf; kdf: Kdf; rng: Rng; defaultKdf: KdfParams }): BackupCrypto {
  async function keyFor(secret: BackupSecret, params: KdfParams | undefined, salt: Uint8Array): Promise<SecretBuf> {
    if (secret.kind === 'passphrase') {
      if (secret.passphrase.length === 0) throw new BackupError('empty_passphrase');
      return kdf.derive(secret.passphrase, salt, params!); // the port refuses parameters below the floors
    }
    return hkdf.derive(secret.key, salt, Uint8Array.from([...text('cashfold.backup.key.v1'), ...secret.fold]), 32);
  }

  return {
    async seal(plain, secret) {
      const mode = secret.kind === 'passphrase' ? 'pass' : 'fk';
      const salt = Uint8Array.from(rng.bytes(16));
      const nonce = Uint8Array.from(rng.bytes(12));
      const key = await keyFor(secret, secret.kind === 'passphrase' ? defaultKdf : undefined, salt);
      try {
        const ct = await aead.seal(key, nonce, plain, aadFor(mode, secret.kind === 'foldKey' ? secret.fold : undefined));
        return encode({ v: 1n, mode, ...(secret.kind === 'passphrase' && { kdf: { ...paramsToWire(defaultKdf) } }), salt, nonce, ct } as never);
      } finally {
        key.wipe();
      }
    },

    async open(file, secret) {
      let m: unknown;
      try {
        m = decode(file);
      } catch {
        throw new BackupError('malformed');
      }
      if (!(m instanceof Map) || m.get('v') !== 1n) throw new BackupError('malformed');
      const [mode, salt, nonce, ct] = [m.get('mode'), m.get('salt'), m.get('nonce'), m.get('ct')];
      if ((mode !== 'pass' && mode !== 'fk') || !(salt instanceof Uint8Array) || !(nonce instanceof Uint8Array) || !(ct instanceof Uint8Array) || nonce.length !== 12) throw new BackupError('malformed');
      if ((mode === 'pass') !== (secret.kind === 'passphrase')) throw new BackupError('wrong_kind');
      const params = mode === 'pass' ? paramsFromWire(m.get('kdf')) : undefined;
      const key = await keyFor(secret, params, salt);
      try {
        return await aead.open(key, nonce, ct, aadFor(mode, secret.kind === 'foldKey' ? secret.fold : undefined));
      } finally {
        key.wipe();
      }
    },
  };
}
