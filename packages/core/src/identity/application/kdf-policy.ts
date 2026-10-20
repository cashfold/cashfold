import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';

// Key-derivation settings come from the service when a device signs in. A service that offers weaker ones than this device
// would choose itself is either broken or hostile, so they are refused before the password is ever used (FR-019). The floors
// match the crypto package's, which enforces the same numbers again at derivation time.

export type KdfSettings =
  | { readonly kdf: 'argon2id'; readonly mKib: number; readonly t: number; readonly p: number }
  | { readonly kdf: 'pbkdf2-hmac-sha256'; readonly iterations: number };

export const KDF_FLOORS = {
  argon2id: { mKib: 32_768, t: 2, p: 1 },
  pbkdf2: { iterations: 600_000 },
} as const;

// Ceilings keep a hostile service from making a device grind or run out of memory: 1 GiB, 64 passes, 16 lanes, 100 million.
const CEILINGS = { mKib: 1_048_576, t: 64, p: 16, iterations: 100_000_000 } as const;

export type KdfPolicyError = DomainError<'kdf_below_floor' | 'kdf_invalid'>;

const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

export function checkKdfPolicy(settings: KdfSettings): Result<KdfSettings, KdfPolicyError> {
  if (settings.kdf === 'argon2id') {
    const { mKib, t, p } = settings;
    if (!whole(mKib) || !whole(t) || !whole(p)) return err('kdf_invalid', 'The service sent key-derivation settings this device cannot use');
    if (mKib > CEILINGS.mKib || t > CEILINGS.t || p > CEILINGS.p) return err('kdf_invalid', 'The service sent key-derivation settings this device cannot use');
    const f = KDF_FLOORS.argon2id;
    if (mKib < f.mKib || t < f.t || p < f.p) return err('kdf_below_floor', 'The service offered weaker password protection than this device accepts');
    return ok(settings);
  }
  if (settings.kdf === 'pbkdf2-hmac-sha256') {
    if (!whole(settings.iterations) || settings.iterations > CEILINGS.iterations) return err('kdf_invalid', 'The service sent key-derivation settings this device cannot use');
    if (settings.iterations < KDF_FLOORS.pbkdf2.iterations) return err('kdf_below_floor', 'The service offered weaker password protection than this device accepts');
    return ok(settings);
  }
  return err('kdf_invalid', 'The service sent key-derivation settings this device cannot use');
}
