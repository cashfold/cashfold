import { describe, expect, it } from 'vitest';
import aes from '../../../../../vectors/kat/aes-256-gcm.json' with { type: 'json' };
import hkdfVectors from '../../../../../vectors/kat/hkdf-sha256.json' with { type: 'json' };
import pbkdf2Vectors from '../../../../../vectors/kat/pbkdf2-sha256.json' with { type: 'json' };
import { AeadError } from '../../ports/index';
import { SecretBuf } from '../../secret-buf';
import { hex, toHex } from '../../test-support';
import { createAesGcm } from './aes-gcm';
import { createHkdf } from './hkdf';
import { createPbkdf2 } from './pbkdf2';

describe('AES-256-GCM (NIST SP 800-38D / GCM spec vectors)', () => {
  const aead = createAesGcm();
  for (const v of aes.cases) {
    it(`${v.name}: seal and open`, async () => {
      const key = SecretBuf.from(hex(v.key));
      const sealed = await aead.seal(key, hex(v.iv), hex(v.pt), hex(v.aad));
      expect(toHex(sealed)).toBe(v.ct + v.tag);
      expect(toHex(await aead.open(key, hex(v.iv), sealed, hex(v.aad)))).toBe(v.pt);
    });
  }

  it('rejects tampered ciphertext, tag, aad and nonce with AeadError', async () => {
    const v = aes.cases[1]!;
    const key = SecretBuf.from(hex(v.key));
    const sealed = await aead.seal(key, hex(v.iv), hex(v.pt), hex(v.aad));
    const flipped = Uint8Array.from(sealed);
    flipped[0] = flipped[0]! ^ 1;
    const badTag = Uint8Array.from(sealed);
    badTag[badTag.length - 1] = badTag[badTag.length - 1]! ^ 1;
    await expect(aead.open(key, hex(v.iv), flipped, hex(v.aad))).rejects.toBeInstanceOf(AeadError);
    await expect(aead.open(key, hex(v.iv), badTag, hex(v.aad))).rejects.toBeInstanceOf(AeadError);
    await expect(aead.open(key, hex(v.iv), sealed, hex('00'))).rejects.toBeInstanceOf(AeadError);
    await expect(aead.open(key, hex('000000000000000000000000'), sealed, hex(v.aad))).rejects.toBeInstanceOf(AeadError);
  });

  it('requires a 32-byte key and 12-byte nonce', async () => {
    await expect(aead.seal(SecretBuf.from(new Uint8Array(16)), new Uint8Array(12), new Uint8Array(1), new Uint8Array())).rejects.toThrow();
    await expect(aead.seal(SecretBuf.from(new Uint8Array(32)), new Uint8Array(8), new Uint8Array(1), new Uint8Array())).rejects.toThrow();
  });
});

describe('HKDF-SHA256 (RFC 5869)', () => {
  const hkdf = createHkdf();
  for (const v of hkdfVectors.cases) {
    it(v.name, async () => {
      const okm = await hkdf.derive(SecretBuf.from(hex(v.ikm)), hex(v.salt), hex(v.info), v.length);
      expect(toHex(okm.use((b) => b))).toBe(v.okm);
    });
  }
});

describe('PBKDF2-HMAC-SHA256 (RFC 7914 section 11)', () => {
  const kdf = createPbkdf2();
  it.each(pbkdf2Vectors.cases)('c=$iterations', async (v) => {
    const out = await kdf.raw(SecretBuf.from(new TextEncoder().encode(v.password)), new TextEncoder().encode(v.salt), v.iterations, v.dkLen);
    expect(toHex(out.use((b) => b))).toBe(v.dk);
  });
});
