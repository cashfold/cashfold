import { describe, expect, it } from 'vitest';
import { createAesGcm } from '../adapters/webcrypto/aes-gcm';
import { createHkdf } from '../adapters/webcrypto/hkdf';
import { createPbkdf2 } from '../adapters/webcrypto/pbkdf2';
import { AeadError, KdfBelowFloor, type Rng } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import { BackupError, createBackupCrypto } from './backup-crypto';

const rng: Rng = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
// PBKDF2 keeps the tests quick; Argon2id is what the app passes, with the same floors enforced by the same port.
const backup = createBackupCrypto({ aead: createAesGcm(), hkdf: createHkdf(), kdf: createPbkdf2(), rng, defaultKdf: { kdf: 'pbkdf2-hmac-sha256', iterations: 600_000 } });
const plain = new TextEncoder().encode('the whole Fold, as the app wrote it');
const pass = (s: string) => ({ kind: 'passphrase' as const, passphrase: SecretBuf.from(new TextEncoder().encode(s)) });
const foldKey = (n: number) => ({ kind: 'foldKey' as const, key: SecretBuf.from(new Uint8Array(32).fill(n)), fold: new Uint8Array(16).fill(1) });

describe('encrypted backup (FR-091)', () => {
  it('seals under a passphrase and opens with the same one, and the file shows nothing of what is inside', async () => {
    const file = await backup.seal(plain, pass('correct horse'));
    expect(Buffer.from(file).includes(Buffer.from('Fold'))).toBe(false);
    expect(await backup.open(file, pass('correct horse'))).toEqual(plain);
  });

  it('refuses a wrong passphrase and any change to the file', async () => {
    const file = await backup.seal(plain, pass('correct horse'));
    await expect(backup.open(file, pass('wrong horse'))).rejects.toBeInstanceOf(AeadError);
    const flipped = Uint8Array.from(file);
    flipped[flipped.length - 2] = flipped[flipped.length - 2]! ^ 1;
    await expect(backup.open(flipped, pass('correct horse'))).rejects.toThrow();
    await expect(backup.open(file.slice(0, 20), pass('correct horse'))).rejects.toBeInstanceOf(BackupError);
    await expect(backup.open(new Uint8Array([1, 2, 3]), pass('x'))).rejects.toBeInstanceOf(BackupError);
  });

  it('seals under the Fold key for the same Fold, and only that Fold\'s key opens it', async () => {
    const file = await backup.seal(plain, foldKey(7));
    expect(await backup.open(file, foldKey(7))).toEqual(plain);
    await expect(backup.open(file, foldKey(8))).rejects.toBeInstanceOf(AeadError);
    await expect(backup.open(file, { ...foldKey(7), fold: new Uint8Array(16).fill(2) })).rejects.toBeInstanceOf(AeadError);
  });

  it('a passphrase file cannot be opened as a Fold-key file or the other way round', async () => {
    const byPass = await backup.seal(plain, pass('p'));
    await expect(backup.open(byPass, foldKey(7))).rejects.toBeInstanceOf(BackupError);
    const byKey = await backup.seal(plain, foldKey(7));
    await expect(backup.open(byKey, pass('p'))).rejects.toBeInstanceOf(BackupError);
  });

  it('never seals the same way twice', async () => {
    const [a, b] = [await backup.seal(plain, pass('p')), await backup.seal(plain, pass('p'))];
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('refuses a file that asks for key stretching below the floors, before deriving anything', async () => {
    const weak = createBackupCrypto({ aead: createAesGcm(), hkdf: createHkdf(), kdf: createPbkdf2(), rng, defaultKdf: { kdf: 'pbkdf2-hmac-sha256', iterations: 1_000 } });
    await expect(weak.seal(plain, pass('p'))).rejects.toBeInstanceOf(KdfBelowFloor);
  });

  it('refuses an empty passphrase', async () => {
    await expect(backup.seal(plain, pass(''))).rejects.toBeInstanceOf(BackupError);
  });
});
