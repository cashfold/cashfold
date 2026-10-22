import { encode } from '@cashfold/protocol/cbor';
import { describe, expect, it } from 'vitest';
import { createAesGcm } from '../adapters/webcrypto/aes-gcm';
import { createHkdf } from '../adapters/webcrypto/hkdf';
import { createPbkdf2 } from '../adapters/webcrypto/pbkdf2';
import { AeadError, KdfBelowFloor, type Kdf, type KdfParams, type Rng } from '../ports/index';
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

describe('encrypted backup, wire format', () => {
  // Argon2id itself is tested elsewhere; this stands in for it so the wire format for its parameters is exercised quickly.
  const seen: KdfParams[] = [];
  const fakeKdf: Kdf = {
    async derive(password, salt, params) {
      seen.push(params);
      return SecretBuf.from(new Uint8Array(32).fill(password.length + salt[0]! * 0));
    },
  };
  const argon = { kdf: 'argon2id' as const, mKib: 65_536, t: 3, p: 1 };
  const withArgon = createBackupCrypto({ aead: createAesGcm(), hkdf: createHkdf(), kdf: fakeKdf, rng, defaultKdf: argon });

  it('writes Argon2id parameters into the file and reads them back when opening', async () => {
    const file = await withArgon.seal(plain, pass('p'));
    expect(await withArgon.open(file, pass('p'))).toEqual(plain);
    expect(seen.at(-1)).toEqual(argon);
  });

  const nonce = new Uint8Array(12);
  const body = { v: 1n, mode: 'pass', salt: new Uint8Array(16), nonce, ct: new Uint8Array(32) };
  const bad = (over: Record<string, unknown>) => encode({ ...body, ...over } as never);

  it.each([
    ['not a map at all', encode([1n, 2n] as never)],
    ['another version', bad({ v: 2n, kdf: { kdf: 'pbkdf2-hmac-sha256', iter: 600_000n } })],
    ['an unknown mode', bad({ mode: 'other' })],
    ['a salt that is not bytes', bad({ salt: 'salt', kdf: { kdf: 'pbkdf2-hmac-sha256', iter: 600_000n } })],
    ['a nonce of the wrong length', bad({ nonce: new Uint8Array(11), kdf: { kdf: 'pbkdf2-hmac-sha256', iter: 600_000n } })],
    ['no key-stretching parameters', bad({})],
    ['key-stretching parameters that are not a map', bad({ kdf: 'argon2id' })],
    ['Argon2id with a missing field', bad({ kdf: { kdf: 'argon2id', m_kib: 65_536n, t: 3n } })],
    ['PBKDF2 with a non-integer count', bad({ kdf: { kdf: 'pbkdf2-hmac-sha256', iter: 'many' } })],
    ['an unknown key-stretching function', bad({ kdf: { kdf: 'scrypt', iter: 1n } })],
  ])('refuses a file with %s', async (_name, file) => {
    await expect(backup.open(file, pass('p'))).rejects.toBeInstanceOf(BackupError);
  });
});
