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

export function createAccountCrypto(options: AccountCryptoOptions): AccountCryptoPort & UnlockCryptoPort {
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
      const pwBuf = copyOf(password);
      const wipe: Wipeable[] = [password, pwBuf];
      try {
        const header = decode(credentials.sealed);
        if (!(header instanceof Map) || header.get('v') !== 1n) return 'wrong_password';
        const deviceSalt = header.get('device_salt');
        const kdfRecord = header.get('kdf');
        const blob = header.get('blob');
        if (!(deviceSalt instanceof Uint8Array) || deviceSalt.length !== 16 || !(blob instanceof Uint8Array) || blob.length < 28 || !(kdfRecord instanceof Map) || kdfRecord.get('kdf') !== 'argon2id') return 'wrong_password';
        const [m, t, p] = [kdfRecord.get('m_kib'), kdfRecord.get('t'), kdfRecord.get('p')];
        if (typeof m !== 'bigint' || typeof t !== 'bigint' || typeof p !== 'bigint') return 'wrong_password';

        const normalised = normalisePassword(pwBuf);
        wipe.push(normalised);
        const lvk = await kdf.derive(normalised, deviceSalt, { kdf: 'argon2id', mKib: Number(m), t: Number(t), p: Number(p) });
        wipe.push(lvk);

        const plaintext = await aead.open(lvk, blob.slice(0, 12), blob.slice(12), aadFor(credentials.deviceId));
        const fields = decode(plaintext) as Map<string, CborValue>;
        const [secretKeyText, deviceSk] = [fields.get('secret_key'), fields.get('device_sk')];
        if (typeof secretKeyText !== 'string' || !(deviceSk instanceof Uint8Array)) return 'wrong_password';
        const out: UnlockedMaterial = {
          sessionKey: await databaseKey(lvk, credentials.deviceId),
          deviceSigningKey: SecretBuf.from(deviceSk),
          secretKey: SecretBuf.from(text(secretKeyText)),
        };
        plaintext.fill(0);
        deviceSk.fill(0);
        return out;
      } catch (e) {
        // A wrong password, a damaged blob, tampered parameters or a different device all look the same on purpose.
        if (e instanceof KdfBelowFloor || (e as Error).name === 'AeadError' || e instanceof RangeError || e instanceof TypeError || (e as Error).name === 'CborError') return 'wrong_password';
        throw e;
      } finally {
        wipe.forEach((s) => s.wipe());
      }
    },
  };
}

export type { DeviceCredentials };
