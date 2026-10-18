import { describe, expect, it } from 'vitest';
import a1 from '../../../../vectors/kat/hpke-rfc9180-a1.json' with { type: 'json' };
import interop from '../../../../vectors/kat/hpke-aes256-interop.json' with { type: 'json' };
import { createAesGcm } from '../adapters/webcrypto/aes-gcm.js';
import { AeadError, type Aead, type Rng } from '../ports/index.js';
import { SecretBuf } from '../secret-buf.js';
import { hex, toHex } from '../test-support.js';
import { createHpke } from './hpke.js';

/** RFC 9180 A.1 uses AES-128-GCM; the production adapter is AES-256 only, so the test supplies its own. */
const aes128: Aead = {
  async seal(key, nonce, plaintext, aad) {
    const k = await key.use((raw) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt']));
    return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource }, k, plaintext as BufferSource));
  },
  async open(key, nonce, sealed, aad) {
    const k = await key.use((raw) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['decrypt']));
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource }, k, sealed as BufferSource));
    } catch {
      throw new AeadError();
    }
  },
};

const fixedRng = (bytes: string): Rng => ({ bytes: (n) => hex(bytes).slice(0, n) });
const osRng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };

describe('HPKE base mode, DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 (RFC 9180 A.1.1, AES-128-GCM)', () => {
  const hpke = createHpke({ aead: aes128, aeadId: 1 });

  it('derives the recipient key pair from ikmR', async () => {
    const kp = await hpke.generate(fixedRng(a1.ikmR));
    expect(toHex(kp.publicKey)).toBe(a1.pkRm);
    expect(toHex(kp.secretKey.use((s) => s))).toBe(a1.skRm);
  });

  it('seal reproduces enc and the first ciphertext', async () => {
    const sealed = await hpke.seal({ recipientPublicKey: hex(a1.pkRm), info: hex(a1.info), aad: hex(a1.aad), plaintext: hex(a1.pt), rng: fixedRng(a1.ikmE) });
    expect(toHex(sealed.enc)).toBe(a1.enc);
    expect(toHex(sealed.ct)).toBe(a1.ct);
  });

  it('open decrypts the RFC ciphertext', async () => {
    const pt = await hpke.open({ recipientSecretKey: SecretBuf.from(hex(a1.skRm)), enc: hex(a1.enc), info: hex(a1.info), aad: hex(a1.aad), ct: hex(a1.ct) });
    expect(toHex(pt)).toBe(a1.pt);
  });
});

describe('HPKE with AES-256-GCM (production suite, interop vector from an independent implementation)', () => {
  const hpke = createHpke({ aead: createAesGcm(), aeadId: 2 });

  it('opens a ciphertext produced by pyhpke', async () => {
    const pt = await hpke.open({ recipientSecretKey: SecretBuf.from(hex(interop.skR)), enc: hex(interop.enc), info: hex(interop.info), aad: hex(interop.aad), ct: hex(interop.ct) });
    expect(toHex(pt)).toBe(interop.pt);
  });

  it('derives the same recipient key pair as pyhpke', async () => {
    const kp = await hpke.generate(fixedRng(interop.ikmR));
    expect(toHex(kp.publicKey)).toBe(interop.pkR);
    expect(toHex(kp.secretKey.use((s) => s))).toBe(interop.skR);
  });

  it('round-trips with fresh randomness and binds info and aad', async () => {
    const kp = await hpke.generate(osRng);
    const args = { info: hex('0102'), aad: hex('0304'), plaintext: hex('05060708') };
    const { enc, ct } = await hpke.seal({ recipientPublicKey: kp.publicKey, rng: osRng, ...args });
    expect(toHex(await hpke.open({ recipientSecretKey: kp.secretKey, enc, ct, info: args.info, aad: args.aad }))).toBe('05060708');
    await expect(hpke.open({ recipientSecretKey: kp.secretKey, enc, ct, info: hex('ff'), aad: args.aad })).rejects.toBeInstanceOf(AeadError);
    await expect(hpke.open({ recipientSecretKey: kp.secretKey, enc, ct, info: args.info, aad: hex('ff') })).rejects.toBeInstanceOf(AeadError);
    const other = await hpke.generate(osRng);
    await expect(hpke.open({ recipientSecretKey: other.secretKey, enc, ct, info: args.info, aad: args.aad })).rejects.toBeInstanceOf(AeadError);
  });

  it('uses a fresh ephemeral key per seal', async () => {
    const kp = await hpke.generate(osRng);
    const a = await hpke.seal({ recipientPublicKey: kp.publicKey, info: hex(''), aad: hex(''), plaintext: hex('00'), rng: osRng });
    const b = await hpke.seal({ recipientPublicKey: kp.publicKey, info: hex(''), aad: hex(''), plaintext: hex('00'), rng: osRng });
    expect(toHex(a.enc)).not.toBe(toHex(b.enc));
  });

  it('rejects malformed enc and low-order points', async () => {
    const kp = await hpke.generate(osRng);
    await expect(hpke.open({ recipientSecretKey: kp.secretKey, enc: new Uint8Array(31), info: hex(''), aad: hex(''), ct: new Uint8Array(20) })).rejects.toThrow();
    await expect(hpke.open({ recipientSecretKey: kp.secretKey, enc: new Uint8Array(32), info: hex(''), aad: hex(''), ct: new Uint8Array(20) })).rejects.toThrow();
  });
});

describe('HPKE seal input validation', () => {
  it('rejects a recipient public key of the wrong length', async () => {
    const hpke = createHpke({ aead: createAesGcm(), aeadId: 2 });
    await expect(hpke.seal({ recipientPublicKey: new Uint8Array(31), info: hex(''), aad: hex(''), plaintext: hex('00'), rng: osRng })).rejects.toThrow(RangeError);
  });
});
