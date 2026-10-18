import { SecretBuf, createAesGcm, createArgon2Kdf, createEd25519Signer, createHkdf, createKeySetService, createPbkdf2, createTwoSkd, composeKdf, parseSecretKey, KdfBelowFloor } from '@cashfold/crypto';
import { decodeKeySet } from '@cashfold/protocol';
import { describe, expect, it } from 'vitest';
import { createAccountCrypto } from './account-crypto';

const osRng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };
const FAST = { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 } as const; // the floor: keeps the suite quick
const make = () => createAccountCrypto({ rng: osRng, kdf: FAST });
const pw = (text: string) => SecretBuf.from(new TextEncoder().encode(text));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const contains = (hay: Uint8Array, needle: Uint8Array) => hex(hay).includes(hex(needle));
const PASSWORD = 'correct horse battery staple';

describe('createAccount', () => {
  it('produces a Secret Key, a registration payload and sealed device credentials', async () => {
    const password = pw(PASSWORD);
    const m = await make().createAccount({ email: 'Alice@Example.com', password });
    expect(m.secretKeyText).toMatch(/^C1-[A-HJ-NP-Z2-9]{6}-[A-HJ-NP-Z2-9]{11}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(m.accountId).toBe(m.secretKeyText.slice(3, 9));
    expect(m.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(m.registration).toMatchObject({ accountId: m.accountId, deviceId: m.deviceId });
    expect(m.registration.deviceSigPk).toHaveLength(32);
    expect(m.sessionKey.length).toBe(32);
    expect(password.isWiped).toBe(true);
  }, 60_000);

  it('registers a key set that records the KDF parameters and opens only with password AND Secret Key', async () => {
    const m = await make().createAccount({ email: 'alice@example.com', password: pw(PASSWORD) });
    const keySet = decodeKeySet(m.registration.keySet);
    expect(keySet.kdf).toMatchObject({ kdf: 'argon2id', m_kib: 32768, t: 2, p: 1, v: 19 });

    const twoSkd = createTwoSkd({ hkdf: createHkdf(), kdf: composeKdf(createArgon2Kdf(), createPbkdf2()) });
    const keysets = createKeySetService({ aead: createAesGcm(), signer: createEd25519Signer(), rng: osRng });
    const derive = (password: string, secret: string) => twoSkd.derive({ password: pw(password), email: 'alice@example.com', secretKey: parseSecretKey(secret), salt16: (keySet.kdf as { enc_salt: Uint8Array }).enc_salt, purpose: 'auk', kdf: FAST });

    const opened = await keysets.open(keySet, await derive(PASSWORD, m.secretKeyText));
    expect(opened.encSk.length).toBe(32);
    await expect(keysets.open(keySet, await derive('another long password!', m.secretKeyText))).rejects.toThrow();
    const other = 'C1-' + m.accountId + '-AAAAAAAAAAA-AAAAA-AAAAA-AAAAA';
    await expect(keysets.open(keySet, await derive(PASSWORD, other))).rejects.toThrow();
  }, 60_000);

  it('keeps every secret out of the registration payload and out of the stored credentials in the clear', async () => {
    const m = await make().createAccount({ email: 'alice@example.com', password: pw(PASSWORD) });
    const secretChars = m.secretKeyText.slice(10).replaceAll('-', '');
    const enc = new TextEncoder();
    for (const blob of [m.registration.keySet, m.credentials.sealed]) {
      expect(contains(blob, enc.encode(secretChars))).toBe(false);
      expect(contains(blob, enc.encode(PASSWORD))).toBe(false);
    }
    expect(contains(m.registration.keySet, m.sessionKey.use((b) => Uint8Array.from(b)))).toBe(false);
    expect(JSON.stringify(m.registration, (_k, v) => (v instanceof Uint8Array ? hex(v) : v))).not.toContain(secretChars);
  }, 60_000);

  it('gives each account its own salts, device id, keys and database key', async () => {
    const a = await make().createAccount({ email: 'a@example.com', password: pw(PASSWORD) });
    const b = await make().createAccount({ email: 'a@example.com', password: pw(PASSWORD) });
    expect(a.deviceId).not.toBe(b.deviceId);
    expect(a.secretKeyText).not.toBe(b.secretKeyText);
    expect(hex(a.sessionKey.use((x) => Uint8Array.from(x)))).not.toBe(hex(b.sessionKey.use((x) => Uint8Array.from(x))));
    expect(hex(a.credentials.sealed)).not.toBe(hex(b.credentials.sealed));
  }, 60_000);

  it('refuses parameters below the floor and still wipes the password', async () => {
    const weak = createAccountCrypto({ rng: osRng, kdf: { kdf: 'argon2id', mKib: 1024, t: 1, p: 1 } });
    const password = pw(PASSWORD);
    await expect(weak.createAccount({ email: 'a@example.com', password })).rejects.toBeInstanceOf(KdfBelowFloor);
    expect(password.isWiped).toBe(true);
  }, 30_000);
});

describe('unlock', () => {
  async function account() {
    const crypto = make();
    const m = await crypto.createAccount({ email: 'alice@example.com', password: pw(PASSWORD) });
    const credentials = { ...m.credentials, email: 'alice@example.com', server: 'https://relay.example.com', registration: 'done' as const };
    return { crypto, m, credentials };
  }

  it('reopens the credentials with the same password and yields the same database key, signing key and Secret Key', async () => {
    const { crypto, m, credentials } = await account();
    const first = hex(m.sessionKey.use((b) => Uint8Array.from(b)));
    const result = await crypto.unlock({ password: pw(PASSWORD), credentials });
    if (result === 'wrong_password') throw new Error('should have unlocked');
    expect(hex(result.sessionKey.use((b) => Uint8Array.from(b)))).toBe(first);
    expect(new TextDecoder().decode(result.secretKey.use((b) => Uint8Array.from(b)))).toBe(m.secretKeyText);
    const signer = createEd25519Signer();
    expect(hex(await signer.publicKey(result.deviceSigningKey as SecretBuf))).toBe(hex(m.registration.deviceSigPk));
  }, 60_000);

  it('treats equivalent spellings and stray spaces as the same password (FR-005)', async () => {
    const crypto = make();
    const m = await crypto.createAccount({ email: 'a@example.com', password: pw('Ångström-pass-phrase-2024') });
    const credentials = { ...m.credentials, email: 'a@example.com', server: 'https://relay.example.com', registration: 'done' as const };
    for (const spelling of ['Ångström-pass-phrase-2024', '  Ångström-pass-phrase-2024 \n']) {
      expect(await crypto.unlock({ password: pw(spelling), credentials })).not.toBe('wrong_password');
    }
  }, 60_000);

  it('says only "wrong_password" for a wrong password, a damaged blob or a different device', async () => {
    const { crypto, credentials } = await account();
    expect(await crypto.unlock({ password: pw('some other long password'), credentials })).toBe('wrong_password');
    const damaged = Uint8Array.from(credentials.sealed);
    damaged[damaged.length - 5] = damaged[damaged.length - 5]! ^ 1;
    expect(await crypto.unlock({ password: pw(PASSWORD), credentials: { ...credentials, sealed: damaged } })).toBe('wrong_password');
    expect(await crypto.unlock({ password: pw(PASSWORD), credentials: { ...credentials, deviceId: '00000000-0000-4000-8000-000000000001' as never } })).toBe('wrong_password');
  }, 90_000);

  it('wipes the password whatever happens', async () => {
    const { crypto, credentials } = await account();
    const password = pw('wrong password here');
    await crypto.unlock({ password, credentials });
    expect(password.isWiped).toBe(true);
  }, 60_000);

  it('refuses stored parameters below the floor (a tampered blob cannot downgrade the KDF)', async () => {
    const { crypto, credentials } = await account();
    const { decode, encode } = await import('@cashfold/protocol');
    const header = decode(credentials.sealed) as Map<string, unknown>;
    header.set('kdf', new Map<string, unknown>([['kdf', 'argon2id'], ['m_kib', 8n], ['t', 1n], ['p', 1n]]));
    const tampered = encode(header as never);
    await expect(crypto.unlock({ password: pw(PASSWORD), credentials: { ...credentials, sealed: tampered } })).resolves.toBe('wrong_password');
  }, 60_000);
});
