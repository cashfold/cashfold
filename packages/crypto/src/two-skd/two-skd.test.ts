import { describe, expect, it } from 'vitest';
import vectors from '../../../../vectors/2skd/2skd.json' with { type: 'json' };
import { createArgon2Kdf } from '../adapters/argon2-wasm/argon2id';
import { createHkdf } from '../adapters/webcrypto/hkdf';
import { createPbkdf2 } from '../adapters/webcrypto/pbkdf2';
import { KdfBelowFloor, type KdfParams } from '../ports/index';
import { parseSecretKey } from '../secret-key/secret-key';
import { SecretBuf } from '../secret-buf';
import { hex, toHex } from '../test-support';
import { composeKdf, createTwoSkd, normalisePassword, type Purpose } from './two-skd';

const twoSkd = createTwoSkd({ hkdf: createHkdf(), kdf: composeKdf(createArgon2Kdf(), createPbkdf2()) });
const pw = (s: string) => SecretBuf.from(new TextEncoder().encode(s));
const toParams = (k: (typeof vectors.cases)[number]['kdf']): KdfParams =>
  k.kdf === 'argon2id' ? { kdf: 'argon2id', mKib: (k as { m_kib: number }).m_kib, t: (k as { t: number }).t, p: (k as { p: number }).p } : { kdf: 'pbkdf2-hmac-sha256', iterations: (k as { iter: number }).iter };
const input = (password: string, purpose: Purpose, kdf: KdfParams, over: Partial<{ email: string; secret: string; salt: string }> = {}) => ({
  password: pw(password),
  email: over.email ?? vectors.inputs.email,
  secretKey: parseSecretKey(over.secret ?? vectors.inputs.secret_key_text),
  salt16: hex(over.salt ?? vectors.inputs.salt16),
  purpose,
  kdf,
});

describe('2SKD against an independent implementation (Python argon2-cffi, hashlib, cryptography)', () => {
  for (const c of vectors.cases) {
    it(c.name, async () => {
      const out = await twoSkd.derive(input(c.password, c.purpose as Purpose, toParams(c.kdf)));
      expect(toHex(out.use((b) => b))).toBe(c.k_p);
    }, 30_000);
  }

  it('intermediate values match too: S_eff, K_sk', async () => {
    const c = vectors.cases[0]!;
    const secretKey = parseSecretKey(vectors.inputs.secret_key_text);
    const parts = await twoSkd.components({ ...input(c.password, 'auk', toParams(c.kdf)), secretKey });
    expect(toHex(parts.sEff)).toBe(c.s_eff);
    expect(toHex(parts.kSk.use((b) => b))).toBe(c.k_sk);
    expect(toHex(parts.kPw.use((b) => b))).toBe(c.k_pw);
  }, 30_000);
});

describe('password normalisation (NFKD of the trimmed password)', () => {
  it('gives identical keys for canonically equivalent spellings and surrounding whitespace', async () => {
    const kdf = toParams(vectors.normalisation.kdf);
    for (const v of vectors.normalisation.variants) {
      const out = await twoSkd.derive(input(v, 'auk', kdf));
      expect(toHex(out.use((b) => b)), JSON.stringify(v)).toBe(vectors.normalisation.k_p);
    }
  }, 60_000);

  it('removes only leading and trailing whitespace, and keeps case and inner spaces', () => {
    const decode = (s: SecretBuf) => new TextDecoder().decode(s.use((b) => b));
    expect(decode(normalisePassword(pw('  a b \n')))).toBe('a b');
    expect(decode(normalisePassword(pw('Abc')))).toBe('Abc');
    expect(decode(normalisePassword(pw('Å')))).toBe('Å');
    expect(decode(normalisePassword(pw('ＡＢ')))).toBe('AB'); // NFKD folds full-width forms
  });

  it('returns a fresh buffer and leaves the input alone', () => {
    const input = pw('x');
    const out = normalisePassword(input);
    expect(out).not.toBe(input);
    expect(input.isWiped).toBe(false);
  });
});

describe('what each input changes', () => {
  const kdf: KdfParams = { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 };
  const k = async (...args: Parameters<typeof input>) => toHex((await twoSkd.derive(input(...args))).use((b) => b));

  it('email case does not matter, email identity does', async () => {
    const base = await k('pw-pw-pw-pw-pw', 'auk', kdf);
    expect(await k('pw-pw-pw-pw-pw', 'auk', kdf, { email: vectors.inputs.email.toUpperCase() })).toBe(base);
    expect(await k('pw-pw-pw-pw-pw', 'auk', kdf, { email: 'bob@example.com' })).not.toBe(base);
  });

  it('purpose, salt, password and Secret Key each give an unrelated key', async () => {
    const base = await k('pw-pw-pw-pw-pw', 'auk', kdf);
    expect(await k('pw-pw-pw-pw-pw', 'srp', kdf)).not.toBe(base);
    expect(await k('pw-pw-pw-pw-pw', 'auk', kdf, { salt: 'ff'.repeat(16) })).not.toBe(base);
    expect(await k('pw-pw-pw-pw-px', 'auk', kdf)).not.toBe(base);
    expect(await k('pw-pw-pw-pw-pw', 'auk', kdf, { secret: 'C1-ABCDEF-GHJKLMNPQRS-TUVWX-YZ234-56788' })).not.toBe(base);
  });

  it('the Secret Key alone is not enough: the password still matters, and vice versa', async () => {
    const a = await k('first-password-1', 'auk', kdf);
    const b = await k('second-password-2', 'auk', kdf);
    expect(a).not.toBe(b);
  });
});

describe('parameter floors are enforced (a malicious server cannot downgrade the KDF)', () => {
  it.each([
    { kdf: 'argon2id', mKib: 1024, t: 3, p: 1 },
    { kdf: 'argon2id', mKib: 32768, t: 1, p: 1 },
    { kdf: 'pbkdf2-hmac-sha256', iterations: 1000 },
  ] as KdfParams[])('rejects %j', async (kdf) => {
    await expect(twoSkd.derive(input('pw-pw-pw-pw-pw', 'auk', kdf))).rejects.toBeInstanceOf(KdfBelowFloor);
  });
});
