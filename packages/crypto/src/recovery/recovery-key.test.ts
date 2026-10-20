import { describe, expect, it } from 'vitest';
import { AeadError, type Rng } from '../ports/index';
import { createAesGcm } from '../adapters/webcrypto/aes-gcm';
import { createHkdf } from '../adapters/webcrypto/hkdf';
import { createEd25519Signer } from '../adapters/noble/ed25519';
import { SecretBuf } from '../secret-buf';
import { createRecovery, formatRecoveryKey, generateRecoveryKey, parseRecoveryKey, RecoveryKeyError } from './recovery-key';

const rng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
const recovery = createRecovery({ aead: createAesGcm(), hkdf: createHkdf(), rng });
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const bytesOf = (s: SecretBuf) => s.use((b) => Uint8Array.from(b));

describe('Recovery Key (FR-009, ARCH 6.8)', () => {
  it('is 32 random bytes, shown once as grouped text that parses back exactly', () => {
    const rk = generateRecoveryKey(rng);
    expect(rk.length).toBe(32);
    const text = formatRecoveryKey(rk);
    expect(text).toMatch(/^R1(-[A-Z2-9]{5}){10}-[A-Z2-9]{1,5}$/);
    expect(bytesOf(parseRecoveryKey(text))).toEqual(bytesOf(rk));
    expect(bytesOf(parseRecoveryKey(text.toLowerCase().replaceAll('-', ' ')))).toEqual(bytesOf(rk));
    expect(hex(bytesOf(generateRecoveryKey(rng)))).not.toBe(hex(bytesOf(rk)));
  });

  it('refuses text that is not a Recovery Key without saying what it contained', () => {
    const good = formatRecoveryKey(generateRecoveryKey(rng));
    for (const bad of ['', 'R1', 'R2-AAAAA', good.slice(0, -3), `${good}A`, good.replace(/^R1/, 'R0'), good.replace('-', '-I')]) {
      expect(() => parseRecoveryKey(bad)).toThrow(RecoveryKeyError);
    }
    try {
      parseRecoveryKey('R1-SECRET-NOT');
    } catch (e) {
      expect(String(e)).not.toContain('SECRET');
    }
  });

  it('derives three independent values from one key with fixed labels', async () => {
    const rk = SecretBuf.from(new Uint8Array(32).fill(7));
    const d = await recovery.derive(rk);
    expect(d.auth.length).toBe(32);
    expect(d.enc.length).toBe(32);
    expect(d.uuid.length).toBe(16);
    expect(hex(bytesOf(d.auth))).not.toBe(hex(bytesOf(d.enc)));
    const again = await recovery.derive(SecretBuf.from(new Uint8Array(32).fill(7)));
    expect(hex(bytesOf(again.auth))).toBe(hex(bytesOf(d.auth)));
    expect(hex(again.uuid)).toBe(hex(d.uuid));
    const other = await recovery.derive(SecretBuf.from(new Uint8Array(32).fill(8)));
    expect(hex(other.uuid)).not.toBe(hex(d.uuid));
  });

  it('matches the specified derivation: HKDF-SHA256 over the key with the three labels', async () => {
    const rk = new Uint8Array(32).fill(7);
    const hkdf = createHkdf();
    const expected = async (label: string, n: number) => bytesOf(await hkdf.derive(SecretBuf.from(rk), new Uint8Array(0), new TextEncoder().encode(label), n));
    const d = await recovery.derive(SecretBuf.from(rk));
    expect(bytesOf(d.auth)).toEqual(await expected('CASHFOLD_RECOVERY_KEY_AUTH_v1', 32));
    expect(bytesOf(d.enc)).toEqual(await expected('CASHFOLD_RECOVERY_KEY_ENC_v1', 32));
    expect(d.uuid).toEqual((await expected('CASHFOLD_RECOVERY_KEY_UUID', 32)).slice(0, 16));
  });

  it('wraps the key set\'s private keys so only the Recovery Key opens them', async () => {
    const signer = createEd25519Signer();
    const sig = await signer.generate(rng);
    const encSk = SecretBuf.from(rng.bytes(32));
    const rk = generateRecoveryKey(rng);
    const d = await recovery.derive(rk);
    const wrapped = await recovery.wrap(d, { encSk, sigSk: sig.secretKey });
    expect(wrapped.length).toBeGreaterThan(64 + 24);
    const opened = await recovery.unwrap(d, wrapped);
    expect(bytesOf(opened.encSk)).toEqual(bytesOf(encSk));
    expect(bytesOf(opened.sigSk)).toEqual(bytesOf(sig.secretKey));

    const wrong = await recovery.derive(generateRecoveryKey(rng));
    await expect(recovery.unwrap(wrong, wrapped)).rejects.toBeInstanceOf(AeadError);
    const flipped = Uint8Array.from(wrapped);
    flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 1;
    await expect(recovery.unwrap(d, flipped)).rejects.toBeInstanceOf(AeadError);
  });

  it('binds the wrapped keys to the recovery identity: another uuid cannot open them', async () => {
    const rk = generateRecoveryKey(rng);
    const d = await recovery.derive(rk);
    const wrapped = await recovery.wrap(d, { encSk: SecretBuf.from(rng.bytes(32)), sigSk: SecretBuf.from(rng.bytes(32)) });
    await expect(recovery.unwrap({ ...d, uuid: new Uint8Array(16) }, wrapped)).rejects.toBeInstanceOf(AeadError);
  });

  it('seals freshly each time', async () => {
    const d = await recovery.derive(generateRecoveryKey(rng));
    const keys = () => ({ encSk: SecretBuf.from(new Uint8Array(32).fill(1)), sigSk: SecretBuf.from(new Uint8Array(32).fill(2)) });
    expect(hex(await recovery.wrap(d, keys()))).not.toBe(hex(await recovery.wrap(d, keys())));
  });
});
