import { SecretBuf, createAesGcm, createArgon2Kdf, createEd25519Signer, createHkdf, createKeySetService, createPbkdf2, createTwoSkd, composeKdf, parseSecretKey, KdfBelowFloor } from '@cashfold/crypto';
import { decodeKeySet } from '@cashfold/protocol';
import { describe, expect, it } from 'vitest';
import type { Id } from '@cashfold/core';
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

describe('quick unlock (device key wrapped under a WebAuthn PRF output)', () => {
  const prf = (fill: number) => new Uint8Array(32).fill(fill);

  async function enrolled() {
    const crypto = make();
    const m = await crypto.createAccount({ email: 'alice@example.com', password: pw(PASSWORD) });
    const credentials = { ...m.credentials, email: 'alice@example.com', server: 'https://relay.example.com', registration: 'done' as const };
    const blob = await crypto.enrollQuick({ password: pw(PASSWORD), credentials, prfOutput: prf(7) });
    if (blob === 'wrong_password') throw new Error('enrolment failed');
    return { crypto, m, credentials, blob };
  }

  it('opens the same session secrets from the PRF output alone', async () => {
    const { crypto, m, credentials, blob } = await enrolled();
    const result = await crypto.unlockQuick({ blob, prfOutput: prf(7), credentials });
    if (result === 'failed') throw new Error('should have unlocked');
    expect(hex(result.sessionKey.use((b) => Uint8Array.from(b)))).toBe(hex(m.sessionKey.use((b) => Uint8Array.from(b))));
    expect(new TextDecoder().decode(result.secretKey.use((b) => Uint8Array.from(b)))).toBe(m.secretKeyText);
    expect(hex(await createEd25519Signer().publicKey(result.deviceSigningKey as SecretBuf))).toBe(hex(m.registration.deviceSigPk));
  }, 60_000);

  it('refuses a wrong password at enrolment', async () => {
    const { crypto, credentials } = await enrolled();
    expect(await crypto.enrollQuick({ password: pw('some other long password'), credentials, prfOutput: prf(7) })).toBe('wrong_password');
  }, 60_000);

  it('says only "failed" for a different PRF output, a damaged blob or another device', async () => {
    const { crypto, credentials, blob } = await enrolled();
    expect(await crypto.unlockQuick({ blob, prfOutput: prf(8), credentials })).toBe('failed');
    const damaged = Uint8Array.from(blob);
    damaged[damaged.length - 3] = damaged[damaged.length - 3]! ^ 1;
    expect(await crypto.unlockQuick({ blob: damaged, prfOutput: prf(7), credentials })).toBe('failed');
    expect(await crypto.unlockQuick({ blob, prfOutput: prf(7), credentials: { ...credentials, deviceId: '00000000-0000-4000-8000-000000000002' as never } })).toBe('failed');
    expect(await crypto.unlockQuick({ blob: new Uint8Array([1, 2, 3]), prfOutput: prf(7), credentials })).toBe('failed');
  }, 90_000);

  it('does not put the Local Vault Key or the PRF output into the stored blob', async () => {
    const { blob } = await enrolled();
    expect(contains(blob, prf(7))).toBe(false);
    expect(blob.length).toBeLessThan(400);
  }, 60_000);

  it('rejects a PRF output of the wrong length', async () => {
    const { crypto, credentials, blob } = await enrolled();
    expect(await crypto.unlockQuick({ blob, prfOutput: new Uint8Array(16), credentials })).toBe('failed');
    await expect(crypto.enrollQuick({ password: pw(PASSWORD), credentials, prfOutput: new Uint8Array(31) })).rejects.toThrow(RangeError);
  }, 60_000);
});

// --- sync material (US4): verifier, account keys, new-device enrolment, registering a local-only account

async function realPake() {
  const { readFileSync } = await import('node:fs');
  const { createPake, loadSrpBigint } = await import('@cashfold/crypto');
  const dir = new URL('../../../../packages/crypto/src/adapters/srp-wasm/', import.meta.url);
  const bn = await loadSrpBigint(new Uint8Array(readFileSync(new URL('srp-bigint.wasm', dir))), readFileSync(new URL('srp-bigint.wasm.sha256', dir), 'utf8'));
  return createPake({ bn, rng: osRng });
}
let sharedPake: ReturnType<typeof realPake> | undefined;
const withPake = () => createAccountCrypto({ rng: osRng, kdf: FAST, pake: () => (sharedPake ??= realPake()) });
const use = (s: { use<T>(fn: (b: Uint8Array) => T): T }) => hex(s.use((b) => Uint8Array.from(b)));

describe('sync material', () => {
  it('registers a verifier and salts, and keeps the account keys sealed and available after unlock', async () => {
    const crypto = withPake();
    const m = await crypto.createAccount({ email: 'alice@example.com', password: pw(PASSWORD) });
    expect(m.registration.srpVerifier).toHaveLength(512);
    expect(m.registration.authSalt).toHaveLength(16);
    expect(m.registration.kdf).toMatchObject({ mKib: 32768, t: 2, p: 1 });
    expect(m.registration.kdf!.encSalt).toHaveLength(16);
    expect(m.account!.encSk.length).toBe(32);
    expect(m.publicKeys!.enc).toHaveLength(32);

    const credentials = { ...m.credentials, email: 'alice@example.com', server: 'https://relay.example.com', registration: 'done' as const };
    const again = await crypto.unlock({ password: pw(PASSWORD), credentials });
    if (again === 'wrong_password') throw new Error('should unlock');
    expect(use(again.account!.encSk)).toBe(use(m.account!.encSk));
    expect(use(again.account!.sigSk)).toBe(use(m.account!.sigSk));
    expect(use(again.account!.srpX)).toBe(use(m.account!.srpX));
    expect(hex(again.publicKeys!.sig)).toBe(hex(m.publicKeys!.sig));
    expect(contains(m.credentials.sealed, m.account!.encSk.use((b) => Uint8Array.from(b)))).toBe(false); // sealed, never in the clear
  }, 90_000);

  it('leaves the verifier out when this build cannot sync', async () => {
    const m = await make().createAccount({ email: 'alice@example.com', password: pw(PASSWORD) });
    expect(m.registration.srpVerifier).toBeUndefined();
  }, 60_000);
});

describe('new-device enrolment', () => {
  async function origin() {
    const crypto = withPake();
    const m = await crypto.createAccount({ email: 'alice@example.com', password: pw(PASSWORD) });
    const offer = { kdf: 'argon2id' as const, mKib: 32768, t: 2, p: 1, encSalt: m.registration.kdf!.encSalt };
    return { crypto, m, offer, hello: { authSalt: m.registration.authSalt!, kdf: offer } };
  }

  it('derives the same SRP-x and opens the same key set from the password and Secret Key alone', async () => {
    const { crypto, m, hello } = await origin();
    const handle = await crypto.begin({ email: 'Alice@Example.com', password: pw(PASSWORD), secretKeyText: m.secretKeyText });
    if (handle === 'invalid_secret_key') throw new Error('valid key');
    const x = await handle.deriveSrpX(hello);
    expect(use(x)).toBe(use(m.account!.srpX));
    const device = await handle.complete({ keySet: m.registration.keySet, deviceId: '00000000-0000-4000-8000-0000000000d2' as Id });
    if (device === 'wrong_secret') throw new Error('should open');
    expect(use(device.account.encSk)).toBe(use(m.account!.encSk));
    expect(hex(device.publicKeys.enc)).toBe(hex(m.publicKeys!.enc));
    expect(device.accountId).toBe(m.accountId);
    expect(device.deviceSigPk).toHaveLength(32);
    expect(hex(device.deviceSigPk)).not.toBe(hex(m.registration.deviceSigPk)); // its own key

    // and the credentials it made unlock with the same password
    const creds = { ...device.credentials, email: 'alice@example.com', server: 'https://relay.example.com', registration: 'done' as const };
    const reopened = await crypto.unlock({ password: pw(PASSWORD), credentials: creds });
    if (reopened === 'wrong_password') throw new Error('should unlock');
    expect(use(reopened.account!.encSk)).toBe(use(m.account!.encSk));
    handle.wipe();
  }, 120_000);

  it('cannot open the key set with a wrong password or a wrong Secret Key, and says the same for both', async () => {
    const { crypto, m, hello } = await origin();
    const wrongPassword = await crypto.begin({ email: 'alice@example.com', password: pw('some other long password'), secretKeyText: m.secretKeyText });
    if (wrongPassword === 'invalid_secret_key') throw new Error('valid key');
    await wrongPassword.deriveSrpX(hello);
    expect(await wrongPassword.complete({ keySet: m.registration.keySet, deviceId: '00000000-0000-4000-8000-0000000000d3' as Id })).toBe('wrong_secret');

    const other = 'C1-' + m.accountId + '-AAAAAAAAAAA-AAAAA-AAAAA-AAAAA';
    const wrongKey = await crypto.begin({ email: 'alice@example.com', password: pw(PASSWORD), secretKeyText: other });
    if (wrongKey === 'invalid_secret_key') throw new Error('well-formed key');
    await wrongKey.deriveSrpX(hello);
    expect(await wrongKey.complete({ keySet: m.registration.keySet, deviceId: '00000000-0000-4000-8000-0000000000d4' as Id })).toBe('wrong_secret');
  }, 120_000);

  it('refuses a malformed Secret Key straight away, wiping the password', async () => {
    const crypto = withPake();
    const password = pw(PASSWORD);
    expect(await crypto.begin({ email: 'a@example.com', password, secretKeyText: 'not-a-key' })).toBe('invalid_secret_key');
    expect(password.isWiped).toBe(true);
  }, 30_000);

  it('refuses to derive below the floor, from whatever the service offered', async () => {
    const { crypto, m, hello } = await origin();
    const handle = await crypto.begin({ email: 'alice@example.com', password: pw(PASSWORD), secretKeyText: m.secretKeyText });
    if (handle === 'invalid_secret_key') throw new Error('valid key');
    await expect(handle.deriveSrpX({ ...hello, kdf: { ...hello.kdf, mKib: 1024 } })).rejects.toBeInstanceOf(KdfBelowFloor);
  }, 60_000);
});

describe('registering an account that only exists on this device', () => {
  it('builds a registration with a fresh key set that opens with the same password and Secret Key', async () => {
    const crypto = withPake();
    const m = await crypto.createAccount({ email: 'alice@example.com', password: pw(PASSWORD) });
    const credentials = { ...m.credentials, email: 'alice@example.com', server: 'https://relay.example.com', registration: 'pending' as const };
    const prepared = await crypto.prepare({ password: pw(PASSWORD), credentials });
    if (prepared === 'wrong_password') throw new Error('should prepare');
    expect(prepared.registration).toMatchObject({ accountId: m.accountId, deviceId: m.deviceId, email: 'alice@example.com' });
    expect(prepared.registration.srpVerifier).toHaveLength(512);
    expect(hex(prepared.registration.deviceSigPk)).toBe(hex(m.registration.deviceSigPk));
    expect(hex(prepared.registration.srpVerifier!)).toBe(hex(m.registration.srpVerifier!)); // same password and Secret Key, same SRP-x

    // the new key set opens, and the sealed credentials now carry its private keys
    const handle = await crypto.begin({ email: 'alice@example.com', password: pw(PASSWORD), secretKeyText: m.secretKeyText });
    if (handle === 'invalid_secret_key') throw new Error('valid key');
    await handle.deriveSrpX({ authSalt: prepared.registration.authSalt!, kdf: { kdf: 'argon2id', ...prepared.registration.kdf! } });
    const device = await handle.complete({ keySet: prepared.registration.keySet, deviceId: '00000000-0000-4000-8000-0000000000d5' as Id });
    if (device === 'wrong_secret') throw new Error('should open');
    expect(use(device.account.encSk)).toBe(use(prepared.account.encSk));

    const reopened = await crypto.unlock({ password: pw(PASSWORD), credentials: { ...credentials, sealed: prepared.sealed } });
    if (reopened === 'wrong_password') throw new Error('should unlock');
    expect(use(reopened.account!.encSk)).toBe(use(prepared.account.encSk));
  }, 180_000);

  it('says "wrong_password" for a wrong password and wipes it', async () => {
    const crypto = withPake();
    const m = await crypto.createAccount({ email: 'alice@example.com', password: pw(PASSWORD) });
    const credentials = { ...m.credentials, email: 'alice@example.com', server: 'https://relay.example.com', registration: 'pending' as const };
    const password = pw('some other long password');
    expect(await crypto.prepare({ password, credentials })).toBe('wrong_password');
    expect(password.isWiped).toBe(true);
  }, 60_000);
});

// --- changing credentials, moving service, the Recovery Key (US9)

describe('credential change, migration and Recovery Key', () => {
  const NEW_PASSWORD = 'an entirely different passphrase 42';
  const hello = (m: { registration: { authSalt?: Uint8Array; kdf?: { encSalt: Uint8Array } } }) => ({ authSalt: m.registration.authSalt!, kdf: { kdf: 'argon2id' as const, mKib: 32768, t: 2, p: 1, encSalt: m.registration.kdf!.encSalt } });
  async function account() {
    const crypto = withPake();
    const m = await crypto.createAccount({ email: 'alice@example.com', password: pw(PASSWORD) });
    const credentials = { ...m.credentials, email: 'alice@example.com', server: 'https://relay.example.com', registration: 'done' as const };
    return { crypto, m, credentials };
  }
  const sessionKeyOf = async (crypto: ReturnType<typeof withPake>, password: string, credentials: Parameters<ReturnType<typeof withPake>['unlock']>[0]['credentials']) => {
    const opened = await crypto.unlock({ password: pw(password), credentials });
    if (opened === 'wrong_password') throw new Error('should unlock');
    return use(opened.sessionKey);
  };

  it('changes the password: the same keys under a new key-set key, a new verifier, and the local database key does not change', async () => {
    const { crypto, m, credentials } = await account();
    const before = await sessionKeyOf(crypto, PASSWORD, credentials);
    const handle = await crypto.credentialChange.begin({ password: pw(PASSWORD), credentials });
    if (handle === 'wrong_password') throw new Error('right password');
    expect(use(await handle.currentSrpX(hello(m)))).toBe(use(m.account!.srpX));
    const next = pw(NEW_PASSWORD);
    const prepared = await handle.prepare({ keySet: m.registration.keySet, newPassword: next, rotateSecretKey: false });
    handle.wipe();
    expect(next.isWiped).toBe(true);
    expect(prepared.secretKeyText).toBeUndefined();
    expect(prepared.rotation.srpVerifier).toHaveLength(512);
    expect(hex(prepared.rotation.authSalt)).not.toBe(hex(m.registration.authSalt!));

    const changed = { ...credentials, sealed: prepared.sealed };
    expect(await crypto.unlock({ password: pw(PASSWORD), credentials: changed })).toBe('wrong_password');
    expect(await sessionKeyOf(crypto, NEW_PASSWORD, changed)).toBe(before); // the database still opens
    const reopened = await crypto.unlock({ password: pw(NEW_PASSWORD), credentials: changed });
    if (reopened === 'wrong_password') throw new Error('unlocks');
    expect(use(reopened.account!.encSk)).toBe(use(m.account!.encSk));
    expect(use(reopened.account!.srpX)).toBe(use(prepared.srpX));
    expect(use(prepared.srpX)).not.toBe(use(m.account!.srpX));
    expect(contains(prepared.sealed, new TextEncoder().encode(NEW_PASSWORD))).toBe(false);

    // a new device with the same Secret Key and the new password opens the re-wrapped key set, with the same keys
    const enrol = await crypto.begin({ email: 'alice@example.com', password: pw(NEW_PASSWORD), secretKeyText: m.secretKeyText });
    if (enrol === 'invalid_secret_key') throw new Error('valid');
    await enrol.deriveSrpX({ authSalt: prepared.rotation.authSalt, kdf: { kdf: 'argon2id', mKib: 32768, t: 2, p: 1, encSalt: prepared.rotation.kdf.encSalt } });
    const device = await enrol.complete({ keySet: prepared.rotation.keySet, deviceId: '00000000-0000-4000-8000-0000000000e1' as Id });
    if (device === 'wrong_secret') throw new Error('opens');
    expect(use(device.account.encSk)).toBe(use(m.account!.encSk));
    expect(hex(device.publicKeys.enc)).toBe(hex(m.publicKeys!.enc));
    enrol.wipe();
  }, 180_000);

  it('rotates the Secret Key under the same password: a new key for the same account, and the old one no longer opens the key set', async () => {
    const { crypto, m, credentials } = await account();
    const before = await sessionKeyOf(crypto, PASSWORD, credentials);
    const handle = await crypto.credentialChange.begin({ password: pw(PASSWORD), credentials });
    if (handle === 'wrong_password') throw new Error('right password');
    const prepared = await handle.prepare({ keySet: m.registration.keySet, rotateSecretKey: true });
    handle.wipe();
    expect(prepared.secretKeyText).toMatch(new RegExp(`^C1-${m.accountId}-`));
    expect(prepared.secretKeyText).not.toBe(m.secretKeyText);
    const changed = { ...credentials, sealed: prepared.sealed };
    expect(await sessionKeyOf(crypto, PASSWORD, changed)).toBe(before);

    const offer = { authSalt: prepared.rotation.authSalt, kdf: { kdf: 'argon2id' as const, mKib: 32768, t: 2, p: 1, encSalt: prepared.rotation.kdf.encSalt } };
    const old = await crypto.begin({ email: 'alice@example.com', password: pw(PASSWORD), secretKeyText: m.secretKeyText });
    const fresh = await crypto.begin({ email: 'alice@example.com', password: pw(PASSWORD), secretKeyText: prepared.secretKeyText! });
    if (old === 'invalid_secret_key' || fresh === 'invalid_secret_key') throw new Error('valid');
    await old.deriveSrpX(offer);
    await fresh.deriveSrpX(offer);
    expect(await old.complete({ keySet: prepared.rotation.keySet, deviceId: '00000000-0000-4000-8000-0000000000e2' as Id })).toBe('wrong_secret');
    const ok = await fresh.complete({ keySet: prepared.rotation.keySet, deviceId: '00000000-0000-4000-8000-0000000000e3' as Id });
    if (ok === 'wrong_secret') throw new Error('opens');
    expect(use(ok.account.sigSk)).toBe(use(m.account!.sigSk));
  }, 180_000);

  it('refuses a wrong current password for any of them', async () => {
    const { crypto, credentials } = await account();
    expect(await crypto.credentialChange.begin({ password: pw('not the password at all'), credentials })).toBe('wrong_password');
    expect(await crypto.migration.begin({ password: pw('not the password at all'), credentials })).toBe('wrong_password');
  }, 90_000);

  it('builds the registration for another service from the same key set, salts and verifier', async () => {
    const { crypto, m, credentials } = await account();
    const handle = await crypto.migration.begin({ password: pw(PASSWORD), credentials });
    if (handle === 'wrong_password') throw new Error('right password');
    const h = hello(m);
    expect(use(await handle.srpX(h))).toBe(use(m.account!.srpX));
    const payload = await handle.registration({ keySet: m.registration.keySet, email: 'alice@example.com', server: 'https://new.example.com', discoverable: false });
    handle.wipe();
    expect(payload).toMatchObject({ accountId: m.accountId, email: 'alice@example.com', server: 'https://new.example.com', discoverable: false, deviceId: m.deviceId });
    expect(hex(payload.keySet)).toBe(hex(m.registration.keySet));
    expect(hex(payload.authSalt!)).toBe(hex(m.registration.authSalt!));
    expect(hex(payload.srpVerifier!)).toBe(hex(m.registration.srpVerifier!));
    expect(hex(payload.deviceSigPk)).toBe(hex(m.registration.deviceSigPk));
    expect(payload.bundleSig).toHaveLength(64);
  }, 90_000);

  it('makes a Recovery Key that returns the same keys under a new password and Secret Key, and nothing else opens them', async () => {
    const { crypto, m } = await account();
    const made = await crypto.recovery.create({ account: m.account! });
    expect(made.recoveryKeyText).toMatch(/^R1-/);
    expect(made.payload.srpVerifier).toHaveLength(512);
    expect(made.payload.uuid).toHaveLength(16);
    expect(contains(made.payload.wrapped, m.account!.encSk.use((b) => Uint8Array.from(b)))).toBe(false);

    const handle = await crypto.recovery.begin({ recoveryKeyText: made.recoveryKeyText.toLowerCase().replaceAll('-', ' '), email: 'alice@example.com' });
    if (handle === 'invalid_recovery_key') throw new Error('valid');
    const next = pw(NEW_PASSWORD);
    const restored = await handle.restore({ accountId: m.accountId, recovery: { uuid: made.payload.uuid, wrapped: made.payload.wrapped }, keySet: m.registration.keySet, newPassword: next });
    if (restored === 'wrong_key') throw new Error('opens');
    handle.wipe();
    expect(next.isWiped).toBe(false); // the caller still needs it to enrol this device
    expect(restored.secretKeyText).toMatch(new RegExp(`^C1-${m.accountId}-`));
    expect(restored.secretKeyText).not.toBe(m.secretKeyText);

    const enrol = await crypto.begin({ email: 'alice@example.com', password: pw(NEW_PASSWORD), secretKeyText: restored.secretKeyText });
    if (enrol === 'invalid_secret_key') throw new Error('valid');
    await enrol.deriveSrpX({ authSalt: restored.rotation.authSalt, kdf: { kdf: 'argon2id', mKib: 32768, t: 2, p: 1, encSalt: restored.rotation.kdf.encSalt } });
    const device = await enrol.complete({ keySet: restored.rotation.keySet, deviceId: '00000000-0000-4000-8000-0000000000e4' as Id });
    if (device === 'wrong_secret') throw new Error('opens');
    expect(use(device.account.encSk)).toBe(use(m.account!.encSk));
    expect(use(device.account.sigSk)).toBe(use(m.account!.sigSk));
    expect(hex(device.publicKeys.sig)).toBe(hex(m.publicKeys!.sig));

    // another Recovery Key, or wrapped keys belonging to another credential, do not open
    const other = await crypto.recovery.create({ account: m.account! });
    const wrong = await crypto.recovery.begin({ recoveryKeyText: other.recoveryKeyText, email: 'alice@example.com' });
    if (wrong === 'invalid_recovery_key') throw new Error('valid');
    expect(await wrong.restore({ accountId: m.accountId, recovery: { uuid: made.payload.uuid, wrapped: made.payload.wrapped }, keySet: m.registration.keySet, newPassword: pw(NEW_PASSWORD) })).toBe('wrong_key');
    expect(await wrong.restore({ accountId: m.accountId, recovery: { uuid: other.payload.uuid, wrapped: made.payload.wrapped }, keySet: m.registration.keySet, newPassword: pw(NEW_PASSWORD) })).toBe('wrong_key');
  }, 240_000);

  it('rejects text that is not a Recovery Key, and derives the recovery sign-in secret from the key alone', async () => {
    const { crypto, m } = await account();
    expect(await crypto.recovery.begin({ recoveryKeyText: 'C1-AAAAAA-AAAAAAAAAAA-AAAAA-AAAAA-AAAAA', email: 'a@b.cc' })).toBe('invalid_recovery_key');
    expect(await crypto.recovery.begin({ recoveryKeyText: '', email: 'a@b.cc' })).toBe('invalid_recovery_key');
    const made = await crypto.recovery.create({ account: m.account! });
    const a = await crypto.recovery.begin({ recoveryKeyText: made.recoveryKeyText, email: 'a@b.cc' });
    const b = await crypto.recovery.begin({ recoveryKeyText: made.recoveryKeyText, email: 'a@b.cc' });
    if (a === 'invalid_recovery_key' || b === 'invalid_recovery_key') throw new Error('valid');
    const hello0 = { authSalt: made.payload.authSalt, kdf: { kdf: 'argon2id' as const, mKib: 32768, t: 2, p: 1, encSalt: new Uint8Array(16) } };
    expect(use(await a.srpX(hello0))).toBe(use(await b.srpX(hello0)));
  }, 120_000);
});
