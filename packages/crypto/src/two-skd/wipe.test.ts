import { describe, expect, it } from 'vitest';
import { createHkdf } from '../adapters/webcrypto/hkdf';
import { KdfBelowFloor, type Hkdf, type Kdf, type KdfParams } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import { generateSecretKey } from '../secret-key/secret-key';
import { createTwoSkd, type Purpose } from './two-skd';

// FR-017: secrets are wiped as soon as they have been used, on success and on every error path.

const osRng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };
const params: KdfParams = { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 };

/** Records every SecretBuf a collaborator hands back so the test can inspect it afterwards. */
function tracked() {
  const made: SecretBuf[] = [];
  const hkdfInner = createHkdf();
  const hkdf: Hkdf = {
    async derive(ikm, salt, info, length) {
      const out = await hkdfInner.derive(ikm, salt, info, length);
      made.push(out);
      return out;
    },
  };
  const kdf: Kdf = {
    async derive(password, _salt, p) {
      if (p.kdf === 'argon2id' && p.mKib < 32768) throw new KdfBelowFloor('test');
      const out = SecretBuf.from(new Uint8Array(32).fill(7));
      made.push(out);
      return out;
    },
  };
  return { made, hkdf, kdf };
}

const base = (password: SecretBuf, purpose: Purpose = 'auk', kdf: KdfParams = params) => ({
  password, email: 'a@example.com', secretKey: generateSecretKey(osRng), salt16: new Uint8Array(16), purpose, kdf,
});

describe('2SKD wipes what it consumes and what it derives along the way', () => {
  it('wipes the password and every intermediate key, and returns only the result', async () => {
    const t = tracked();
    const password = SecretBuf.from(new TextEncoder().encode('a long password here'));
    const result = await createTwoSkd({ hkdf: t.hkdf, kdf: t.kdf }).derive(base(password));
    expect(password.isWiped).toBe(true);
    expect(result.isWiped).toBe(false);
    const others = t.made.filter((b) => b !== result);
    expect(others.length).toBeGreaterThanOrEqual(2); // K_pw and K_sk, at least
    expect(others.every((b) => b.isWiped)).toBe(true);
  });

  it('wipes the password when the KDF refuses its parameters', async () => {
    const t = tracked();
    const password = SecretBuf.from(new TextEncoder().encode('a long password here'));
    await expect(createTwoSkd({ hkdf: t.hkdf, kdf: t.kdf }).derive(base(password, 'auk', { kdf: 'argon2id', mKib: 1, t: 2, p: 1 }))).rejects.toBeInstanceOf(KdfBelowFloor);
    expect(password.isWiped).toBe(true);
    expect(t.made.every((b) => b.isWiped)).toBe(true);
  });

  it('wipes everything when HKDF fails part-way', async () => {
    const t = tracked();
    let calls = 0;
    const flaky: Hkdf = { derive: (...a) => (++calls === 2 ? Promise.reject(new Error('hkdf down')) : t.hkdf.derive(...a)) };
    const password = SecretBuf.from(new TextEncoder().encode('a long password here'));
    await expect(createTwoSkd({ hkdf: flaky, kdf: t.kdf }).derive(base(password))).rejects.toThrow('hkdf down');
    expect(password.isWiped).toBe(true);
    expect(t.made.every((b) => b.isWiped)).toBe(true);
  });

  it('wipes the normalised copy of the password too', async () => {
    const t = tracked();
    const seen: SecretBuf[] = [];
    const spyKdf: Kdf = { derive: async (pw, salt, p) => (seen.push(pw), t.kdf.derive(pw, salt, p)) };
    await createTwoSkd({ hkdf: t.hkdf, kdf: spyKdf }).derive(base(SecretBuf.from(new TextEncoder().encode(' padded password '))));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.isWiped).toBe(true);
  });
});
