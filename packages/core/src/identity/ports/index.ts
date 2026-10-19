import type { Id } from '../../shared-kernel/id';
import type { DeviceSettings } from '../domain/device-settings';
import type { QuickUnlockRecord } from '../domain/quick-unlock';
import type { FoldDirectory, FoldKeyImportPort, FoldKeyPort } from '../../sharing/ports/index';
import type { CommandBus } from '../../sync/application/buses';

/** A holder of secret bytes. The crypto package's SecretBuf satisfies it; core never imports that package. */
export interface Secret {
  readonly length: number;
  readonly isWiped: boolean;
  use<T>(fn: (bytes: Uint8Array) => T): T;
  wipe(): void;
}

/** Wire-ready registration data: nothing secret, everything the service needs to create the account. */
export interface RegistrationPayload {
  readonly accountId: string;
  readonly email: string;
  readonly discoverable: boolean;
  readonly server: string;
  readonly deviceId: Id;
  /** CBOR key set (encrypted private keys + public keys + KDF parameters). Opaque to core. */
  readonly keySet: Uint8Array;
  /** The device's Ed25519 public key, registered so the service can check the ops this device signs. */
  readonly deviceSigPk: Uint8Array;
  /** SRP verifier, `v = g^x`. Present for every registration made by a client that can reach the relay (US4). */
  readonly srpVerifier?: Uint8Array;
  /** Random salt for the SRP-x derivation; the service hands it back to every device that signs in. */
  readonly authSalt?: Uint8Array;
  /** The password-stretching settings, with the salt for the key-set key. The service enforces the floors again. */
  readonly kdf?: { readonly mKib: number; readonly t: number; readonly p: number; readonly encSalt: Uint8Array };
  /** The account's signature over its public key bundle, which the service hands to people who invite it (FR-106). */
  readonly bundleSig?: Uint8Array;
}

export type RegistrationResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'offline' | 'rejected' | 'email_taken' | 'invite_required' | 'rate_limited' };

export interface RegistrationPort {
  register(payload: RegistrationPayload, options?: { readonly inviteCode?: string }): Promise<RegistrationResult>;
}

/** What survives on the device between sessions (all secrets sealed under the Local Vault Key). */
export interface DeviceCredentials {
  readonly deviceId: Id;
  readonly accountId: string;
  readonly email: string;
  readonly server: string;
  readonly registration: 'pending' | 'done';
  /** Opaque sealed blob: device salt, Secret Key and cached SRP-x. */
  readonly sealed: Uint8Array;
}

export interface CredentialStorePort {
  save(credentials: DeviceCredentials): Promise<void>;
  load(): Promise<DeviceCredentials | undefined>;
  clear(): Promise<void>;
}

/** The account-level secrets sync needs. All three are sealed on the device and live in memory only while it is unlocked. */
export interface AccountSecrets {
  /** X25519 private key: opens Fold-key grants. */
  readonly encSk: Secret;
  /** Ed25519 private key: signs Fold-key grants. */
  readonly sigSk: Secret;
  /** SRP-x for sign-in with the service, cached so unlocking needs one derivation, not two. */
  readonly srpX: Secret;
}

/** Everything created on this device for a new account, from the password and a fresh Secret Key. */
export interface NewAccountMaterial {
  readonly accountId: string;
  /** Shown once to the user and written into the Emergency Kit. */
  readonly secretKeyText: string;
  readonly deviceId: Id;
  readonly registration: Omit<RegistrationPayload, 'email' | 'discoverable' | 'server'>;
  readonly credentials: Omit<DeviceCredentials, 'email' | 'server' | 'registration'>;
  /** Key that opens this device's database for the session (derived from the Local Vault Key). */
  readonly sessionKey: Secret;
  /** This device's Ed25519 signing key, used to sign every op it authors. */
  readonly deviceSigningKey: Secret;
  readonly account?: AccountSecrets;
  /** Public halves, for grants addressed to this account. */
  readonly publicKeys?: { readonly enc: Uint8Array; readonly sig: Uint8Array };
}

/** The secrets a session is started with. The session takes ownership. */
export interface SessionSecrets {
  readonly deviceId: Id;
  readonly sessionKey: Secret;
  readonly deviceSigningKey: Secret;
}

export interface AccountCryptoPort {
  /** Consumes `password`: it is wiped whether this succeeds or fails. */
  createAccount(args: { email: string; password: Secret }): Promise<NewAccountMaterial>;
}

/** Per-device settings kept outside the encrypted database so they apply before and after unlocking. */
export interface DeviceSettingsPort {
  load(): Promise<DeviceSettings>;
  save(settings: DeviceSettings): Promise<void>;
}

/** What unlocking a device yields. The caller tracks every Secret so locking wipes it. */
export interface UnlockedMaterial {
  readonly sessionKey: Secret;
  /** This device's Ed25519 signing key. */
  readonly deviceSigningKey: Secret;
  /** The Secret Key in display form, as bytes: for the Emergency Kit and for adding devices. */
  readonly secretKey: Secret;
  /** Absent on devices set up before sync existed; they gain it when sync is first enabled. */
  readonly account?: AccountSecrets;
  readonly publicKeys?: { readonly enc: Uint8Array; readonly sig: Uint8Array };
}

export interface UnlockCryptoPort {
  /** Consumes `password`. Resolves `wrong_password` when the credentials do not open: no detail beyond that. */
  unlock(args: { password: Secret; credentials: DeviceCredentials }): Promise<UnlockedMaterial | 'wrong_password'>;
}

/** A quick-unlock enrolment: the sealed key material plus the state that decides when it may be used. */
export interface StoredQuickUnlock extends QuickUnlockRecord {
  /** Opaque CBOR: the Local Vault Key wrapped under a device unlock key, itself wrapped under the authenticator's PRF output. */
  readonly blob: Uint8Array;
  /** Salt fed to the authenticator's PRF so it returns this enrolment's secret. */
  readonly prfSalt: Uint8Array;
}

export interface QuickUnlockStorePort {
  load(): Promise<StoredQuickUnlock | undefined>;
  save(record: StoredQuickUnlock): Promise<void>;
  clear(): Promise<void>;
}

export interface QuickUnlockCryptoPort {
  /** Checks the password, then wraps the Local Vault Key under the PRF output. Consumes `password`. */
  enroll(args: { password: Secret; credentials: DeviceCredentials; prfOutput: Uint8Array }): Promise<Uint8Array | 'wrong_password'>;
  /** Opens the session secrets from the PRF output alone. Resolves `failed` for any mismatch, with no detail. */
  unlock(args: { blob: Uint8Array; prfOutput: Uint8Array; credentials: DeviceCredentials }): Promise<UnlockedMaterial | 'failed'>;
}

/** What a started session offers: an open database with its command bus, Fold directory and Fold keys. */
export interface SessionServices {
  readonly commandBus: CommandBus;
  readonly directory: FoldDirectory;
  readonly foldKeys: FoldKeyPort;
  /** Present where the device can receive Fold keys from the service (everywhere in the web app). */
  readonly keyImport?: FoldKeyImportPort;
}

export interface SessionPort {
  /** Opens the encrypted database with the session key and wires the services. */
  start(secrets: SessionSecrets): Promise<SessionServices>;
  /** Closes the database and drops the services. */
  stop(): Promise<void>;
}

// ---------------------------------------------------------------- the service (relay)

export type RelayErrorKind =
  | 'offline'
  /** Wrong credentials, or the service could not prove it knows the account: one answer for both. */
  | 'rejected'
  /** The proof was right, but this device was removed from the account. */
  | 'revoked'
  | 'rate_limited'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  /** The account was deleted on another device. */
  | 'gone'
  | 'bad_request'
  | 'protocol'
  /** The service offered key-derivation settings below the floors. */
  | 'kdf_below_floor';

export type RelayReply =
  | { readonly ok: true; readonly status: number; readonly body: unknown }
  | { readonly ok: false; readonly kind: RelayErrorKind; readonly status?: number; readonly retryAfterS?: number };

/** One signed-in session with the service. Requests are sealed and replay-protected by the adapter. */
export interface RelayLink {
  request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<RelayReply>;
  /** The proof of this sign-in, which account deletion must present while it is fresh. */
  readonly freshProof: Uint8Array;
  close(): void;
}

export interface RelayHello {
  readonly accountId: string;
  readonly authSalt: Uint8Array;
}

export interface RelayAuthPort {
  /**
   * SRP sign-in. `deriveX` is called with the account's salt and settings once the service has offered them, and returns
   * SRP-x (the port wipes it). Never throws for service-side outcomes.
   */
  signIn(args: {
    server: string;
    email: string;
    deviceId: Id;
    deriveX(hello: { authSalt: Uint8Array; kdf: KdfOffer }): Promise<Secret>;
  }): Promise<{ readonly ok: true; readonly accountId: string; readonly link: RelayLink } | { readonly ok: false; readonly kind: RelayErrorKind }>;
}

export type KdfOffer =
  | { readonly kdf: 'argon2id'; readonly mKib: number; readonly t: number; readonly p: number; readonly encSalt: Uint8Array }
  | { readonly kdf: 'pbkdf2-hmac-sha256'; readonly iterations: number; readonly encSalt: Uint8Array };

/** What a new device derives from the password and Secret Key once it knows the account's salts. */
export interface EnrolCryptoHandle {
  /** SRP-x for the sign-in. Also derives the key-set key, so the password is stretched once per purpose. */
  deriveSrpX(hello: { authSalt: Uint8Array; kdf: KdfOffer }): Promise<Secret>;
  /**
   * Opens the personal key set and builds this device's sealed credentials (new device key, Local Vault Key from the same
   * password). Resolves `wrong_secret` when the key set does not open: wrong Secret Key, or a changed account.
   */
  complete(args: { keySet: Uint8Array; deviceId: Id }): Promise<NewDeviceMaterial | 'wrong_secret'>;
  wipe(): void;
}

export interface NewDeviceMaterial {
  readonly deviceId: Id;
  readonly accountId: string;
  readonly deviceSigPk: Uint8Array;
  readonly credentials: Omit<DeviceCredentials, 'email' | 'server' | 'registration'>;
  readonly sessionKey: Secret;
  readonly deviceSigningKey: Secret;
  readonly account: AccountSecrets;
  readonly publicKeys: { readonly enc: Uint8Array; readonly sig: Uint8Array };
}

export interface EnrolCryptoPort {
  /** Consumes `password`. `secretKeyText` is the "C1-…" form from the Emergency Kit or the add-device link. */
  begin(args: { email: string; password: Secret; secretKeyText: string }): Promise<EnrolCryptoHandle | 'invalid_secret_key'>;
}

/** Builds the registration for a device that already holds an account locally (T200). Consumes `password`. */
export interface RegisterExistingCryptoPort {
  prepare(args: { password: Secret; credentials: DeviceCredentials }): Promise<
    | 'wrong_password'
    | { readonly registration: RegistrationPayload; readonly sealed: Uint8Array; readonly account: AccountSecrets; readonly publicKeys: { readonly enc: Uint8Array; readonly sig: Uint8Array } }
  >;
}

/** Wraps and unwraps Fold keys for the account's own devices. */
export interface FoldGrantPort {
  /** One grant per epoch this device holds, addressed to the account's own encryption key. */
  grantsFor(args: { fold: Id; account: AccountSecrets; accountId: string; publicKeys: { enc: Uint8Array; sig: Uint8Array } }): Promise<readonly Uint8Array[]>;
  /** Verifies and opens grants; returns the keys that opened, by epoch. Grants that do not verify are skipped. */
  open(args: { fold: Id; grants: readonly Uint8Array[]; account: AccountSecrets; publicKeys: { enc: Uint8Array; sig: Uint8Array } }): Promise<ReadonlyArray<{ epoch: number; role: 'owner' | 'editor' | 'viewer'; key: Secret }>>;
}

/** Encrypts the label of a device under a key every device of the account holds, so the service cannot read it. */
export interface DeviceLabelPort {
  seal(label: string, account: AccountSecrets): Promise<Uint8Array>;
  /** Undefined when the label does not open (damaged, or written under another key). */
  open(sealed: Uint8Array, account: AccountSecrets): Promise<string | undefined>;
}
