import {
  composeKdf, createAesGcm, createArgon2Kdf, createEd25519Signer, createHkdf, createKeySetService, createPbkdf2, createTwoSkd, generateSecretKey,
  KdfBelowFloor, normalisePassword, parseSecretKey, SecretBuf, type KdfParams, type Pake, type Rng, type SecretKey,
} from '@cashfold/crypto';
import {
  idToBytes, newIdV4, type AccountCryptoPort, type AccountSecrets, type DeviceCredentials, type EnrolCryptoHandle, type EnrolCryptoPort, type Id, type KdfOffer, type NewAccountMaterial, type NewDeviceMaterial,
  type RegisterExistingCryptoPort, type Secret, type UnlockCryptoPort, type UnlockedMaterial,
} from '@cashfold/core';
import { decodeKeySet } from '@cashfold/protocol';
import { decode, encode, type CborValue } from '@cashfold/protocol/cbor';

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
  /** Loads the SRP engine on first use (a WebAssembly module), so accounts that never sync never pay for it. */
  readonly pake?: () => Promise<Pake>;
}

const aadFor = (deviceId: Id): Uint8Array => encode([LABEL, idToBytes(deviceId)]);

export type WebAccountCrypto = AccountCryptoPort & UnlockCryptoPort & EnrolCryptoPort & RegisterExistingCryptoPort & {
  enrollQuick(args: { password: Secret; credentials: DeviceCredentials; prfOutput: Uint8Array }): Promise<Uint8Array | 'wrong_password'>;
  unlockQuick(args: { blob: Uint8Array; prfOutput: Uint8Array; credentials: DeviceCredentials }): Promise<UnlockedMaterial | 'failed'>;
};

/** The account's keys as a device keeps them, sealed in the credentials blob (absent on devices set up before sync). */
interface SealedFields {
  readonly secretKeyText: string;
  readonly srpX: Uint8Array;
  readonly deviceSk: Uint8Array;
  readonly encSalt: Uint8Array;
  readonly authSalt: Uint8Array;
  readonly encSk?: Uint8Array;
  readonly sigSk?: Uint8Array;
  readonly encPk?: Uint8Array;
  readonly sigPk?: Uint8Array;
}

const bytes = (v: CborValue | undefined, len?: number): Uint8Array | undefined => (v instanceof Uint8Array && (len === undefined || v.length === len) ? v : undefined);

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
  const fresh = (n: number) => Uint8Array.from(rng.bytes(n));

  const databaseKey = (lvk: SecretBuf, deviceId: Id) => hkdf.derive(lvk, idToBytes(deviceId), text('cashfold.db.v1'), 32);

  const isBenign = (e: unknown): boolean =>
    e instanceof KdfBelowFloor || (e as Error).name === 'AeadError' || e instanceof RangeError || e instanceof TypeError || (e as Error).name === 'CborError';

  const quickAad = (deviceId: Id, role: 'duk' | 'lvk') => encode(['cashfold.quick.v1', idToBytes(deviceId), role]);
  const quickKek = (prfOutput: Uint8Array, deviceId: Id) => hkdf.derive(SecretBuf.from(prfOutput), idToBytes(deviceId), text('cashfold.quick.kek.v1'), 32);

  /** Seals the fields under the Local Vault Key and wraps them with the device salt and parameters into the stored blob. */
  async function sealCredentials(lvk: SecretBuf, deviceId: Id, deviceSalt: Uint8Array, header: KdfParams & { kdf: 'argon2id' }, f: SealedFields): Promise<Uint8Array> {
    const plaintext = encode({
      secret_key: f.secretKeyText, srp_x: f.srpX, device_sk: f.deviceSk, enc_salt: f.encSalt, auth_salt: f.authSalt,
      ...(f.encSk !== undefined && f.sigSk !== undefined && f.encPk !== undefined && f.sigPk !== undefined && { enc_sk: f.encSk, sig_sk: f.sigSk, enc_pk: f.encPk, sig_pk: f.sigPk }),
    });
    const nonce = fresh(12);
    const blob = Uint8Array.from([...nonce, ...(await aead.seal(lvk, nonce, plaintext, aadFor(deviceId)))]);
    plaintext.fill(0);
    return encode({ v: 1, device_salt: deviceSalt, kdf: { kdf: 'argon2id', m_kib: header.mKib, t: header.t, p: header.p }, blob });
  }

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

  /** Opens the sealed fields with the Local Vault Key. Throws for a wrong key or a damaged blob. */
  async function openFields(lvk: SecretBuf, credentials: DeviceCredentials): Promise<SealedFields> {
    const header = decode(credentials.sealed) as Map<string, CborValue>;
    const blob = header.get('blob');
    if (!(blob instanceof Uint8Array) || blob.length < 28) throw new TypeError('bad blob');
    const plaintext = await aead.open(lvk, blob.slice(0, 12), blob.slice(12), aadFor(credentials.deviceId));
    const fields = decode(plaintext) as Map<string, CborValue>;
    const [secretKeyText, deviceSk, srpX, encSalt, authSalt] = [fields.get('secret_key'), bytes(fields.get('device_sk')), bytes(fields.get('srp_x')), bytes(fields.get('enc_salt'), 16), bytes(fields.get('auth_salt'), 16)];
    if (typeof secretKeyText !== 'string' || deviceSk === undefined || srpX === undefined || encSalt === undefined || authSalt === undefined) throw new TypeError('bad contents');
    const [encSk, sigSk, encPk, sigPk] = [bytes(fields.get('enc_sk'), 32), bytes(fields.get('sig_sk'), 32), bytes(fields.get('enc_pk'), 32), bytes(fields.get('sig_pk'), 32)];
    const out: SealedFields = { secretKeyText, srpX, deviceSk, encSalt, authSalt, ...(encSk && sigSk && encPk && sigPk && { encSk, sigSk, encPk, sigPk }) };
    return out;
  }

  const accountOf = (f: SealedFields): { account: AccountSecrets; publicKeys: { enc: Uint8Array; sig: Uint8Array } } | undefined =>
    f.encSk && f.sigSk && f.encPk && f.sigPk
      ? { account: { encSk: SecretBuf.from(f.encSk), sigSk: SecretBuf.from(f.sigSk), srpX: SecretBuf.from(f.srpX) }, publicKeys: { enc: f.encPk, sig: f.sigPk } }
      : undefined;

  /** Opens the sealed blob with the Local Vault Key and derives the database key. */
  async function openWithLvk(lvk: SecretBuf, credentials: DeviceCredentials): Promise<UnlockedMaterial> {
    const f = await openFields(lvk, credentials);
    const sync = accountOf(f);
    const out: UnlockedMaterial = {
      sessionKey: await databaseKey(lvk, credentials.deviceId),
      deviceSigningKey: SecretBuf.from(f.deviceSk),
      secretKey: SecretBuf.from(text(f.secretKeyText)),
      ...(sync !== undefined && { account: sync.account, publicKeys: sync.publicKeys }),
    };
    for (const b of [f.deviceSk, f.srpX, f.encSk, f.sigSk]) b?.fill(0);
    return out;
  }

  const kdfParamsOf = (offer: KdfOffer): KdfParams => (offer.kdf === 'argon2id' ? { kdf: 'argon2id', mKib: offer.mKib, t: offer.t, p: offer.p } : { kdf: 'pbkdf2-hmac-sha256', iterations: offer.iterations });

  return {
    async createAccount({ email, password }) {
      const pwBuf = copyOf(password);
      const wipe: Wipeable[] = [password, pwBuf];
      try {
        const secretKey = generateSecretKey(rng);
        wipe.push(secretKey);
        const [encSalt, authSalt, deviceSalt] = [fresh(16), fresh(16), fresh(16)] as const;
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
        const srpXBytes = srpX.use((b) => Uint8Array.from(b));
        // The SRP verifier is public to the service by design; it lets the service check a sign-in without learning the password.
        const verifier = options.pake === undefined ? undefined : (await options.pake()).verifier(srpX);

        const sealed = await sealCredentials(lvk, deviceId, deviceSalt, params, {
          secretKeyText, srpX: srpXBytes, deviceSk: device.secretKey.use((b) => Uint8Array.from(b)), encSalt, authSalt,
          encSk: made.encSk.use((b) => Uint8Array.from(b)), sigSk: made.sigSk.use((b) => Uint8Array.from(b)), encPk: made.keySet.enc.pk, sigPk: made.keySet.sig.pk,
        });

        const sessionKey = await databaseKey(lvk, deviceId);
        const material: NewAccountMaterial = {
          accountId: secretKey.accountId,
          secretKeyText,
          deviceId,
          registration: {
            accountId: secretKey.accountId, deviceId, keySet: encode(made.keySet as never), deviceSigPk: device.publicKey, authSalt,
            kdf: { mKib: params.mKib, t: params.t, p: params.p, encSalt },
            ...(verifier !== undefined && { srpVerifier: verifier }),
          },
          credentials: { deviceId, accountId: secretKey.accountId, sealed },
          sessionKey,
          deviceSigningKey: device.secretKey,
          account: { encSk: copyOf(made.encSk), sigSk: copyOf(made.sigSk), srpX: SecretBuf.from(srpXBytes) },
          publicKeys: { enc: made.keySet.enc.pk, sig: made.keySet.sig.pk },
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

    /** Prepares a first registration for an account that has only lived on this device (T200). */
    async prepare({ password, credentials }) {
      const wipe: Wipeable[] = [password];
      try {
        const lvk = await lvkFromPassword(password, credentials, wipe);
        if (lvk === undefined) return 'wrong_password';
        const fields = await openFields(lvk, credentials);
        const header = decode(credentials.sealed) as Map<string, CborValue>;
        const deviceSalt = bytes(header.get('device_salt'), 16)!;
        const kdfRecord = header.get('kdf') as Map<string, CborValue>;
        const accountParams: Extract<KdfParams, { kdf: 'argon2id' }> = { kdf: 'argon2id', mKib: Number(kdfRecord.get('m_kib')), t: Number(kdfRecord.get('t')), p: Number(kdfRecord.get('p')) };

        const secretKey = parseSecretKey(fields.secretKeyText);
        wipe.push(secretKey);
        const pwBuf = copyOf(password);
        wipe.push(pwBuf);
        const auk = await twoSkd.derive({ password: copyOf(pwBuf), email: credentials.email.trim().toLowerCase(), secretKey, salt16: fields.encSalt, purpose: 'auk', kdf: accountParams });
        wipe.push(auk);
        const made = await keySets.create({ auk, kdf: { kdf: 'argon2id', m_kib: accountParams.mKib, t: accountParams.t, p: accountParams.p, v: 19, enc_salt: fields.encSalt } });
        wipe.push(made.encSk, made.sigSk);
        if (options.pake === undefined) throw new Error('sync is not available in this build');
        const srpX = SecretBuf.from(fields.srpX);
        wipe.push(srpX);
        const verifier = (await options.pake()).verifier(srpX);
        const devicePk = await signer.publicKey(SecretBuf.from(fields.deviceSk));

        const sealed = await sealCredentials(lvk, credentials.deviceId, deviceSalt, accountParams, {
          ...fields, encSk: made.encSk.use((b) => Uint8Array.from(b)), sigSk: made.sigSk.use((b) => Uint8Array.from(b)), encPk: made.keySet.enc.pk, sigPk: made.keySet.sig.pk,
        });
        const result = {
          registration: {
            accountId: credentials.accountId, deviceId: credentials.deviceId, keySet: encode(made.keySet as never), deviceSigPk: devicePk, authSalt: fields.authSalt,
            kdf: { mKib: accountParams.mKib, t: accountParams.t, p: accountParams.p, encSalt: fields.encSalt }, srpVerifier: verifier,
            email: credentials.email, discoverable: true, server: credentials.server,
          },
          sealed,
          account: { encSk: copyOf(made.encSk), sigSk: copyOf(made.sigSk), srpX: SecretBuf.from(fields.srpX) },
          publicKeys: { enc: made.keySet.enc.pk, sig: made.keySet.sig.pk },
        };
        return result;
      } catch (e) {
        if (isBenign(e)) return 'wrong_password';
        throw e;
      } finally {
        wipe.forEach((s) => s.wipe());
      }
    },

    /** Starts signing in on a new device: derives only once the service has said which salts and settings apply. */
    async begin({ email, password, secretKeyText }): Promise<EnrolCryptoHandle | 'invalid_secret_key'> {
      let secretKey: SecretKey;
      try {
        secretKey = parseSecretKey(secretKeyText.trim());
      } catch {
        password.wipe();
        return 'invalid_secret_key';
      }
      const pwBuf = copyOf(password);
      password.wipe();
      const normalisedEmail = email.trim().toLowerCase();
      const wipe: Wipeable[] = [pwBuf, secretKey];
      let auk: SecretBuf | undefined;
      let authSalt: Uint8Array | undefined;
      let encSalt: Uint8Array | undefined;
      let srpXCopy: Uint8Array | undefined;
      const wipeAll = () => {
        wipe.forEach((s) => s.wipe());
        srpXCopy?.fill(0);
        auk?.wipe();
      };

      return {
        async deriveSrpX({ authSalt: salt, kdf: offer }) {
          const kdfParams = kdfParamsOf(offer);
          authSalt = salt;
          encSalt = offer.encSalt;
          const mk = (purpose: 'auk' | 'srp', s16: Uint8Array) => ({ password: copyOf(pwBuf), email: normalisedEmail, secretKey, salt16: s16, purpose, kdf: kdfParams });
          auk = await twoSkd.derive(mk('auk', offer.encSalt));
          const x = await twoSkd.derive(mk('srp', salt));
          srpXCopy = x.use((b) => Uint8Array.from(b));
          return x;
        },

        async complete({ keySet, deviceId }): Promise<NewDeviceMaterial | 'wrong_secret'> {
          if (auk === undefined || authSalt === undefined || encSalt === undefined || srpXCopy === undefined) throw new Error('deriveSrpX must run first');
          const created: Wipeable[] = [];
          try {
            let opened;
            try {
              opened = await keySets.open(decodeKeySet(keySet), auk);
            } catch (e) {
              if (isBenign(e) || (e as Error).name === 'ZodError') return 'wrong_secret';
              throw e;
            }
            created.push(opened.encSk, opened.sigSk);
            const parsed = decodeKeySet(keySet);
            const deviceSalt = fresh(16);
            const normalised = normalisePassword(copyOf(pwBuf));
            created.push(normalised);
            const lvk = await kdf.derive(normalised, deviceSalt, params);
            created.push(lvk);
            const device = await signer.generate(rng);
            const sealed = await sealCredentials(lvk, deviceId, deviceSalt, params, {
              secretKeyText: secretKey.format(), srpX: srpXCopy, deviceSk: device.secretKey.use((b) => Uint8Array.from(b)), encSalt, authSalt,
              encSk: opened.encSk.use((b) => Uint8Array.from(b)), sigSk: opened.sigSk.use((b) => Uint8Array.from(b)), encPk: parsed.enc.pk, sigPk: parsed.sig.pk,
            });
            return {
              deviceId, accountId: secretKey.accountId, deviceSigPk: device.publicKey,
              credentials: { deviceId, accountId: secretKey.accountId, sealed },
              sessionKey: await databaseKey(lvk, deviceId), deviceSigningKey: device.secretKey,
              account: { encSk: copyOf(opened.encSk), sigSk: copyOf(opened.sigSk), srpX: SecretBuf.from(srpXCopy) },
              publicKeys: { enc: parsed.enc.pk, sig: parsed.sig.pk },
            };
          } finally {
            created.forEach((s) => s.wipe());
          }
        },

        wipe: wipeAll,
      };
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
