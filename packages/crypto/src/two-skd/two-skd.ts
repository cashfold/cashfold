import type { Hkdf, Kdf, KdfParams } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import type { SecretKey } from '../secret-key/secret-key';

// Two-Secret Key Derivation (ARCH 5.3). The account key combines something the user knows with something they hold:
//   S_eff = HKDF(salt = lower(email), IKM = salt16, info = "cashfold.2skd.v1|salt|" + purpose)
//   K_pw  = KDF(NFKD(trim(password)), S_eff)                    Argon2id, or PBKDF2 where Argon2 is unavailable
//   K_sk  = HKDF(salt = account id, IKM = the 26 secret characters, info = "cashfold.2skd.v1|sk|" + purpose + "|C1")
//   K     = K_pw XOR K_sk
// `derive` consumes the password: it, and every intermediate key, is wiped before it returns, on every path.

export type Purpose = 'auk' | 'srp';

const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

/** NFKD of the trimmed password as UTF-8. Returns a fresh buffer; the input is left for the caller to wipe. */
export function normalisePassword(password: SecretBuf): SecretBuf {
  const decoded = password.use((b) => new TextDecoder().decode(b));
  // The decoded string cannot be wiped: JavaScript strings are immutable. This is an accepted limit (docs/threat-model.md).
  return SecretBuf.take(encode(decoded.trim().normalize('NFKD')));
}

export function composeKdf(argon2id: Kdf, pbkdf2: Kdf): Kdf {
  return { derive: (password, salt, params) => (params.kdf === 'argon2id' ? argon2id : pbkdf2).derive(password, salt, params) };
}

export interface TwoSkdInput {
  /** Consumed: wiped when the call ends. */
  readonly password: SecretBuf;
  readonly email: string;
  readonly secretKey: SecretKey;
  readonly salt16: Uint8Array;
  readonly purpose: Purpose;
  readonly kdf: KdfParams;
}

export interface TwoSkdParts {
  readonly sEff: Uint8Array;
  /** The caller must wipe both. */
  readonly kPw: SecretBuf;
  readonly kSk: SecretBuf;
}

export interface TwoSkd {
  derive(input: TwoSkdInput): Promise<SecretBuf>;
  /** The intermediate values, for known-answer tests. Consumes the password like `derive`. */
  components(input: TwoSkdInput): Promise<TwoSkdParts>;
}

export function createTwoSkd({ hkdf, kdf }: { hkdf: Hkdf; kdf: Kdf }): TwoSkd {
  async function components(input: TwoSkdInput): Promise<TwoSkdParts> {
    const wipe: SecretBuf[] = [input.password];
    try {
      const normalised = normalisePassword(input.password);
      wipe.push(normalised);

      const saltIkm = SecretBuf.from(input.salt16);
      wipe.push(saltIkm);
      const sEffBuf = await hkdf.derive(saltIkm, encode(input.email.toLowerCase()), encode(`cashfold.2skd.v1|salt|${input.purpose}`), 32);
      wipe.push(sEffBuf);
      const sEff = sEffBuf.use((b) => Uint8Array.from(b));

      const kPw = await kdf.derive(normalised, sEff, input.kdf);
      wipe.push(kPw);
      const kSk = await hkdf.derive(input.secretKey.secret, encode(input.secretKey.accountId), encode(`cashfold.2skd.v1|sk|${input.purpose}|C1`), 32);
      // Success: hand kPw and kSk to the caller; wipe only the rest.
      wipe.splice(wipe.indexOf(kPw), 1);
      wipe.forEach((b) => b.wipe());
      return { sEff, kPw, kSk };
    } catch (e) {
      wipe.forEach((b) => b.wipe());
      throw e;
    }
  }

  return {
    components,
    async derive(input) {
      const { kPw, kSk } = await components(input);
      try {
        return SecretBuf.take(kPw.use((a) => kSk.use((b) => Uint8Array.from(a, (x, i) => x ^ b[i]!))));
      } finally {
        kPw.wipe();
        kSk.wipe();
      }
    },
  };
}
