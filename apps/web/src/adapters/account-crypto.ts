import {
  composeKdf, createAesGcm, createArgon2Kdf, createEd25519Signer, createHkdf, createKeySetService, createPbkdf2, createTwoSkd, generateSecretKey,
  KdfBelowFloor, normalisePassword, SecretBuf, type KdfParams, type Rng,
} from '@cashfold/crypto';
import { idToBytes, newIdV4, type AccountCryptoPort, type DeviceCredentials, type Id, type NewAccountMaterial, type Secret, type UnlockCryptoPort, type UnlockedMaterial } from '@cashfold/core';
import { decode, encode, encodeKeySet, type CborValue } from '@cashfold/protocol';

// Account key management for one device, composed from the crypto package (ARCH 5.2 to 5.4):
//   AUK    = 2SKD(password, Secret Key, enc_salt)       unlocks the personal key set; never stored
//   SRP-x  = 2SKD(password, Secret Key, auth_salt)      used for sign-in with the service; cached on the device
//   LVK    = Argon2id(NFKD(trim(password)), device_salt) the Local Vault Key; never stored
//   DBK    = HKDF(LVK, salt = device id, "cashfold.db.v1") opens the encrypted database
// The Secret Key, SRP-x and the device signing key are stored sealed under the LVK. Only the device salt and KDF
// parameters sit beside them in the clear, because they are needed to derive the LVK.

export const DEFAULT_KDF: Extract<KdfParams, { kdf: 'argon2id' }> = { kdf: 'argon2id', mKib: 65536, t: 3, p: 1 };

const LABEL = 'cashfold.dukblob.v1';
type Wipeable = { wipe(): void };
const text = (s: string) => new TextEncoder().encode(s);

export interface AccountCryptoOptions {
  readonly rng: Rng;
  readonly kdf?: Extract<KdfParams, { kdf: 'argon2id' }>;
}

const aadFor = (deviceId: Id): Uint8Array => encode([LABEL, idToBytes(deviceId)]);

export type WebAccountCrypto = AccountCryptoPort & UnlockCryptoPort & {
  enrollQuick(args: { password: Secret; credentials: DeviceCredentials; prfOutput: Uint8Array }): Promise<Uint8Array | 'wrong_password'>;
  unlockQuick(args: { blob: Uint8Array; prfOutput: Uint8Array; credentials: DeviceCredentials }): Promise<UnlockedMaterial | 'failed'>;
};

export function createAccountCrypto(options: AccountCryptoOptions): WebAccountCrypto {
  const { rng } = options;
  const params = options.kdf ?? DEFAULT_KDF;
  const hkdf = createHkdf();
  const kdf = composeKdf(createArgon2Kdf(), createPbkdf2());
  const twoSkd = createTwoSkd({ hkdf, kdf });
  const aead = createAesGcm();
  const signer = createEd25519Signer();
  const keySets = createKeySetService({ aead, signer, rng });
  const copyOf = (s: Secret): SecretBuf => SecretBuf.from(s.use((b) => b));

  const databaseKey = (lvk: SecretBuf, deviceId: Id) => hkdf.derive(lvk, idToBytes(deviceId), text('cashfold.db.v1'), 32);

  const isBenign = (e: unknown): boolean =>
    e instanceof KdfBelowFloor || (e as Error).name === 'AeadError' || e instanceof RangeError || e instanceof TypeError || (e as Error).name === 'CborError';

  const quickAad = (deviceId: Id, role: 'duk' | 'lvk') => encode(['cashfold.quick.v1', idToBytes(deviceId), role]);
  const quickKek = (prfOutput: Uint8Array, deviceId: Id) => hkdf.derive(SecretBuf.from(prfOutput), idToBytes(deviceId), text('cashfold.quick.kek.v1'), 32);

  /** Derives the Local Vault Key from the password and the parameters stored beside the sealed blob. Undefined if the stored header is unusable. */
  async function lvkFromPassword(password: Secret, credentials: DeviceCredentials, wipe: Wipeable[]): Promise<SecretBuf | undefined> {
    const header = decode(credentials.sealed);
    if (!(header instanceof Map) || header.get('v') !== 1n) return undefined;
    const deviceSalt = header.get('device_salt');
    const kdfRecord = header.get('kdf');
    if (!(deviceSalt instanceof Uint8Array) || deviceSalt.length !== 16 || !(kdfRecord instanceof Map) || kdfRecord.get('kdf') !== 'argon2id') return undefined;
    const [m, t, p] = [kdfRecord.get('m_kib'), kdfRecord.get('t'), kdfRecord.get('p')];
    if (typeof m !== 'bigint' || typeof t !== 'bigint' || typeof p !== 'bigint') return undefined;
    const normalised = normalisePassword(copyOf(password));
    wipe.push(normalised);
    const lvk = await kdf.derive(normalised, deviceSalt, { kdf: 'argon2id', mKib: Number(m), t: Number(t), p: Number(p) });
    wipe.push(lvk);
    return lvk;
  }

  /** Opens the sealed blob with the Local Vault Key and derives the database key. */
  async function openWithLvk(lvk: SecretBuf, credentials: DeviceCredentials): Promise<UnlockedMaterial> {
    const header = decode(credentials.sealed) as Map<string, CborValue>;
    const blob = header.get('blob');
    if (!(blob instanceof Uint8Array) || blob.length < 28) throw new TypeError('bad blob');
    const plaintext = await aead.open(lvk, blob.slice(0, 12), blob.slice(12), aadFor(credentials.deviceId));
    const fields = decode(plaintext) as Map<string, CborValue>;
    const [secretKeyText, deviceSk] = [fields.get('secret_key'), fields.get('device_sk')];
    if (typeof secretKeyText !== 'string' || !(deviceSk instanceof Uint8Array)) throw new TypeError('bad contents');
    const out: UnlockedMaterial = {
      sessionKey: await databaseKey(lvk, credentials.deviceId),
      deviceSigningKey: SecretBuf.from(deviceSk),
      secretKey: SecretBuf.from(text(secretKeyText)),
    };
    plaintext.fill(0);
    deviceSk.fill(0);
    return out;
  }

  return {
    async createAccount({ email, password }) {
      const pwBuf = copyOf(password);
      const wipe: Wipeable[] = [password, pwBuf];
      try {
        const secretKey = generateSecretKey(rng);
        wipe.push(secretKey);
        const [encSalt, authSalt, deviceSalt] = [rng.bytes(16), rng.bytes(16), rng.bytes(16)].map((b) => Uint8Array.from(b)) as [Uint8Array, Uint8Array, Uint8Array];
        const normalisedEmail = email.trim().toLowerCase();
        const input = (purpose: 'auk' | 'srp', salt16: Uint8Array) => ({ password: copyOf(pwBuf), email: normalisedEmail, secretKey, salt16, purpose, kdf: params });

        const auk = await twoSkd.derive(input('auk', encSalt));
        wipe.push(auk);
        const srpX = await twoSkd.derive(input('srp', authSalt));
        wipe.push(srpX);
        const normalised = normalisePassword(pwBuf);
        wipe.push(normalised);
        const lvk = await kdf.derive(normalised, deviceSalt, params);
        wipe.push(lvk);

        const made = await keySets.create({ auk, kdf: { kdf: 'argon2id', m_kib: params.mKib, t: params.t, p: params.p, v: 19, enc_salt: encSalt } });
        wipe.push(made.encSk, made.sigSk);

        const device = await signer.generate(rng);
        const deviceId = newIdV4((n) => rng.bytes(n));
        const secretKeyText = secretKey.format();

        const plaintext = encode({
          secret_key: secretKeyText,
          srp_x: srpX.use((b) => Uint8Array.from(b)),
          device_sk: device.secretKey.use((b) => Uint8Array.from(b)),
          enc_salt: encSalt,
          auth_salt: authSalt,
        });
        const nonce = Uint8Array.from(rng.bytes(12));
        const blob = Uint8Array.from([...nonce, ...(await aead.seal(lvk, nonce, plaintext, aadFor(deviceId)))]);
        plaintext.fill(0);
        const sealed = encode({ v: 1, device_salt: deviceSalt, kdf: { kdf: 'argon2id', m_kib: params.mKib, t: params.t, p: params.p }, blob });

        const sessionKey = await databaseKey(lvk, deviceId);
        const material: NewAccountMaterial = {
          accountId: secretKey.accountId,
          secretKeyText,
          deviceId,
          registration: { accountId: secretKey.accountId, deviceId, keySet: encodeKeySet(made.keySet), deviceSigPk: device.publicKey },
          credentials: { deviceId, accountId: secretKey.accountId, sealed },
          sessionKey,
          deviceSigningKey: device.secretKey,
        };
        return material;
      } finally {
        wipe.forEach((s) => s.wipe());
      }
    },

    async unlock({ password, credentials }): Promise<UnlockedMaterial | 'wrong_password'> {
      const wipe: Wipeable[] = [password];
      try {
        const lvk = await lvkFromPassword(password, credentials, wipe);
        return lvk === undefined ? 'wrong_password' : await openWithLvk(lvk, credentials);
      } catch (e) {
        // A wrong password, a damaged blob, tampered parameters or a different device all look the same on purpose.
        if (isBenign(e)) return 'wrong_password';
        throw e;
      } finally {
        wipe.forEach((s) => s.wipe());
      }
    },

    /** Wraps the Local Vault Key under the authenticator's PRF output for quick unlock. Checks the password first. */
    async enrollQuick({ password, credentials, prfOutput }) {
      if (prfOutput.length !== 32) throw new RangeError('a PRF output is 32 bytes');
      const wipe: Wipeable[] = [password];
      try {
        const lvk = await lvkFromPassword(password, credentials, wipe);
        if (lvk === undefined) return 'wrong_password';
        const material = await openWithLvk(lvk, credentials).catch((e: unknown) => (isBenign(e) ? undefined : Promise.reject(e)));
        if (material === undefined) return 'wrong_password';
        for (const secret of [material.sessionKey, material.deviceSigningKey, material.secretKey]) secret.wipe();

        const duk = SecretBuf.take(Uint8Array.from(rng.bytes(32)));
        wipe.push(duk);
        const kek = await quickKek(prfOutput, credentials.deviceId);
        wipe.push(kek);
        const sealUnder = async (key: SecretBuf, plaintext: Uint8Array, role: 'duk' | 'lvk') => {
          const nonce = Uint8Array.from(rng.bytes(12));
          return Uint8Array.from([...nonce, ...(await aead.seal(key, nonce, plaintext, quickAad(credentials.deviceId, role)))]);
        };
        const wrappedDuk = await sealUnder(kek, duk.use((b) => b), 'duk');
        const wrappedLvk = await sealUnder(duk, lvk.use((b) => b), 'lvk');
        return encode({ v: 1, wrapped_duk: wrappedDuk, wrapped_lvk: wrappedLvk });
      } finally {
        wipe.forEach((s) => s.wipe());
      }
    },

    /** Opens the session secrets from the PRF output alone. Any mismatch is just `failed`. */
    async unlockQuick({ blob, prfOutput, credentials }): Promise<UnlockedMaterial | 'failed'> {
      const wipe: Wipeable[] = [];
      try {
        if (prfOutput.length !== 32) return 'failed';
        const record = decode(blob);
        if (!(record instanceof Map) || record.get('v') !== 1n) return 'failed';
        const [wrappedDuk, wrappedLvk] = [record.get('wrapped_duk'), record.get('wrapped_lvk')];
        if (!(wrappedDuk instanceof Uint8Array) || !(wrappedLvk instanceof Uint8Array) || wrappedDuk.length < 28 || wrappedLvk.length < 28) return 'failed';
        const kek = await quickKek(prfOutput, credentials.deviceId);
        wipe.push(kek);
        const duk = SecretBuf.take(await aead.open(kek, wrappedDuk.slice(0, 12), wrappedDuk.slice(12), quickAad(credentials.deviceId, 'duk')));
        wipe.push(duk);
        const lvk = SecretBuf.take(await aead.open(duk, wrappedLvk.slice(0, 12), wrappedLvk.slice(12), quickAad(credentials.deviceId, 'lvk')));
        wipe.push(lvk);
        return await openWithLvk(lvk, credentials);
      } catch (e) {
        if (isBenign(e)) return 'failed';
        throw e;
      } finally {
        wipe.forEach((s) => s.wipe());
      }
    },
  };
}

export type { DeviceCredentials };
