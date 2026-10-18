import type { Id } from '../../shared-kernel/id';
import type { FoldDirectory, FoldKeyPort } from '../../sharing/ports/index';
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
  /** SRP verifier; absent until sign-in with the relay exists (US4). */
  readonly srpVerifier?: Uint8Array;
}

export type RegistrationResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'offline' | 'rejected' | 'email_taken' };

export interface RegistrationPort {
  register(payload: RegistrationPayload): Promise<RegistrationResult>;
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
}

export interface AccountCryptoPort {
  /** Consumes `password`: it is wiped whether this succeeds or fails. */
  createAccount(args: { email: string; password: Secret }): Promise<NewAccountMaterial>;
}

/** What unlocking a device yields. The caller tracks every Secret so locking wipes it. */
export interface UnlockedMaterial {
  readonly sessionKey: Secret;
  /** This device's Ed25519 signing key. */
  readonly deviceSigningKey: Secret;
  /** The Secret Key in display form, as bytes: for the Emergency Kit and for adding devices. */
  readonly secretKey: Secret;
}

export interface UnlockCryptoPort {
  /** Consumes `password`. Resolves `wrong_password` when the credentials do not open: no detail beyond that. */
  unlock(args: { password: Secret; credentials: DeviceCredentials }): Promise<UnlockedMaterial | 'wrong_password'>;
}

/** What a started session offers: an open database with its command bus, Fold directory and Fold keys. */
export interface SessionServices {
  readonly commandBus: CommandBus;
  readonly directory: FoldDirectory;
  readonly foldKeys: FoldKeyPort;
}

export interface SessionPort {
  /** Opens the encrypted database with `sessionKey` and wires the services. Takes ownership of the key. */
  start(sessionKey: Secret): Promise<SessionServices>;
  /** Closes the database and drops the services. */
  stop(): Promise<void>;
}
