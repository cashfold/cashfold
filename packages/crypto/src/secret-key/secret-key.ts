import type { Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';

// The Secret Key (ARCH 5.2): `C1-AAAAAA-SSSSSSSSSSS-SSSSS-SSSSS-SSSSS`.
//   C1      format tag, not secret
//   AAAAAA  account id, random, not secret (30 bits)
//   S...    26 secret characters, 5 random bits each = 130 bits, from a 32-symbol alphabet without I, O, 0, 1.
// Five bits per symbol means every symbol is equally likely: no modulo bias.

export const SECRET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const VERSION_TAG = 'C1';
const ID_CHARS = 6;
const SECRET_CHARS = 26;
const ID_BYTES = 4;
const SECRET_BYTES = 17;

export type SecretKeyErrorCode = 'invalid_length' | 'invalid_version' | 'invalid_character';

/** Thrown for malformed text. The message never contains the text that was rejected. */
export class SecretKeyError extends Error {
  constructor(readonly code: SecretKeyErrorCode) {
    super(`Not a valid Secret Key (${code})`);
    this.name = 'SecretKeyError';
  }
}

/** The first `count` 5-bit groups of `bytes`, most significant bit first, as alphabet characters. */
function encodeBits(bytes: Uint8Array, count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) {
    let value = 0;
    for (let bit = 0; bit < 5; bit++) {
      const index = i * 5 + bit;
      value = (value << 1) | ((bytes[index >> 3]! >> (7 - (index & 7))) & 1);
    }
    out += SECRET_ALPHABET[value];
  }
  return out;
}

const group = (s: string): string => `${s.slice(0, 11)}-${s.slice(11, 16)}-${s.slice(16, 21)}-${s.slice(21)}`;

export class SecretKey {
  constructor(readonly accountId: string, readonly secret: SecretBuf) {}

  /** The display form, for showing once and for the Emergency Kit. */
  format(): string {
    const text = this.secret.use((b) => new TextDecoder().decode(b));
    return `${VERSION_TAG}-${this.accountId}-${group(text)}`;
  }

  wipe(): void {
    this.secret.wipe();
  }

  toJSON(): { accountId: string } {
    return { accountId: this.accountId };
  }

  toString(): string {
    return `SecretKey(${this.accountId})`;
  }
}

/** A fresh Secret Key. With `accountId`, a new secret for an existing account (recovery, rotation): the account does not change. */
export function generateSecretKey(rng: Rng, accountId?: string): SecretKey {
  const bytes = rng.bytes(ID_BYTES + SECRET_BYTES);
  accountId ??= encodeBits(bytes.subarray(0, ID_BYTES), ID_CHARS);
  const secret = SecretBuf.take(new TextEncoder().encode(encodeBits(bytes.subarray(ID_BYTES), SECRET_CHARS)));
  if (bytes instanceof Uint8Array) bytes.fill(0);
  return new SecretKey(accountId, secret);
}

/** Accepts the display form, with or without hyphens, spaces or newlines, in any case. */
export function parseSecretKey(text: string): SecretKey {
  const compact = text.replace(/[\s-]/g, '').toUpperCase();
  if (compact.length !== VERSION_TAG.length + ID_CHARS + SECRET_CHARS) throw new SecretKeyError('invalid_length');
  if (!compact.startsWith(VERSION_TAG)) throw new SecretKeyError('invalid_version');
  const body = compact.slice(VERSION_TAG.length);
  for (const c of body) if (!SECRET_ALPHABET.includes(c)) throw new SecretKeyError('invalid_character');
  return new SecretKey(body.slice(0, ID_CHARS), SecretBuf.take(new TextEncoder().encode(body.slice(ID_CHARS))));
}
