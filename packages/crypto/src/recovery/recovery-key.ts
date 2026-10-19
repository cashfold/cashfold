import type { Aead, Hkdf, Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import { SECRET_ALPHABET } from '../secret-key/secret-key';

// The Recovery Key (ARCH 6.8, FR-009): an optional second way back into an account when the password or Secret Key is lost.
//   RKm    = 32 random bytes, shown once, kept by the person
//   RK_auth = HKDF(RKm, "CASHFOLD_RECOVERY_KEY_AUTH_v1")   -> the secret of a second SRP credential
//   RK_enc  = HKDF(RKm, "CASHFOLD_RECOVERY_KEY_ENC_v1")    -> wraps the key set's private keys (AES-256-GCM)
//   RK_uuid = HKDF(RKm, "CASHFOLD_RECOVERY_KEY_UUID")[0:16] -> names the credential without revealing anything
// The service stores only the second SRP verifier and the wrapped keys.

export class RecoveryKeyError extends Error {
  constructor(readonly code: 'invalid_length' | 'invalid_version' | 'invalid_character') {
    super(`Not a valid Recovery Key (${code})`);
    this.name = 'RecoveryKeyError';
  }
}

const PREFIX = 'R1';
const KEY_BYTES = 32;
const TEXT_CHARS = 52; // 256 bits at 5 bits each, rounded up
const WRAP_LABEL = 'cashfold.recovery.wrap.v1';
const enc = (s: string) => new TextEncoder().encode(s);

export const generateRecoveryKey = (rng: Rng): SecretBuf => SecretBuf.from(Uint8Array.from(rng.bytes(KEY_BYTES)));

function toBase32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += SECRET_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += SECRET_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** `R1-AAAAA-BBBBB-…`: the key in the 32-symbol alphabet without look-alike characters, in groups of five. */
export function formatRecoveryKey(key: SecretBuf): string {
  const body = key.use((b) => toBase32(b));
  return `${PREFIX}-${body.match(/.{1,5}/g)!.join('-')}`;
}

/** Reads what a person typed or pasted. Case, spaces and dashes do not matter. The message never repeats the text. */
export function parseRecoveryKey(text: string): SecretBuf {
  const compact = text.trim().toUpperCase().replace(/[\s-]+/g, '');
  if (!compact.startsWith(PREFIX)) throw new RecoveryKeyError(compact.length === 0 ? 'invalid_length' : 'invalid_version');
  const body = compact.slice(PREFIX.length);
  if (body.length !== TEXT_CHARS) throw new RecoveryKeyError('invalid_length');
  const out = new Uint8Array(KEY_BYTES);
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const ch of body) {
    const v = SECRET_ALPHABET.indexOf(ch);
    if (v < 0) throw new RecoveryKeyError('invalid_character');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      if (at < KEY_BYTES) out[at++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return SecretBuf.take(out);
}

export interface RecoveryDerived {
  /** The secret of the recovery credential (the SRP-x). */
  readonly auth: SecretBuf;
  readonly enc: SecretBuf;
  readonly uuid: Uint8Array;
}

export interface RecoveryKeys {
  readonly encSk: SecretBuf;
  readonly sigSk: SecretBuf;
}

export interface Recovery {
  /** Consumes nothing: the caller wipes `key`. The caller wipes `auth` and `enc` from the result. */
  derive(key: SecretBuf): Promise<RecoveryDerived>;
  wrap(derived: RecoveryDerived, keys: RecoveryKeys): Promise<Uint8Array>;
  /** Rejects with `AeadError` for a wrong key, another identity or any change. The caller wipes the keys. */
  unwrap(derived: RecoveryDerived, wrapped: Uint8Array): Promise<RecoveryKeys>;
}

export function createRecovery({ aead, hkdf, rng }: { aead: Aead; hkdf: Hkdf; rng: Rng }): Recovery {
  const empty = new Uint8Array(0);
  const aadFor = (uuid: Uint8Array) => Uint8Array.from([...enc(WRAP_LABEL), ...uuid]);
  return {
    async derive(key) {
      const [auth, encKey, uuid] = await Promise.all([
        hkdf.derive(key, empty, enc('CASHFOLD_RECOVERY_KEY_AUTH_v1'), 32),
        hkdf.derive(key, empty, enc('CASHFOLD_RECOVERY_KEY_ENC_v1'), 32),
        hkdf.derive(key, empty, enc('CASHFOLD_RECOVERY_KEY_UUID'), 32),
      ]);
      const id = uuid.use((b) => Uint8Array.from(b.slice(0, 16)));
      uuid.wipe();
      return { auth, enc: encKey, uuid: id };
    },

    async wrap(derived, keys) {
      const nonce = Uint8Array.from(rng.bytes(12));
      const plain = Uint8Array.from([...keys.encSk.use((b) => b), ...keys.sigSk.use((b) => b)]);
      try {
        const sealed = await aead.seal(derived.enc, nonce, plain, aadFor(derived.uuid));
        return Uint8Array.from([...nonce, ...sealed]);
      } finally {
        plain.fill(0);
      }
    },

    async unwrap(derived, wrapped) {
      const plain = await aead.open(derived.enc, wrapped.slice(0, 12), wrapped.slice(12), aadFor(derived.uuid));
      if (plain.length !== 64) throw new RecoveryKeyError('invalid_length');
      const encSk = SecretBuf.from(plain.slice(0, 32));
      const sigSk = SecretBuf.from(plain.slice(32));
      plain.fill(0);
      return { encSk, sigSk };
    },
  };
}
