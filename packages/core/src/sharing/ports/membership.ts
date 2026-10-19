import type { Id } from '../../shared-kernel/id';
import type { Result } from '../../shared-kernel/result';
import type { Secret } from '../../identity/ports/index';
import type { LogCrypto, MembershipEntry, RoleCode } from '../domain/membership-log';

// What sharing needs from the outside world. Core never imports the crypto or protocol packages: the platform supplies these.

/** The local copy of a Fold's membership log. */
export interface MembershipStore {
  list(fold: Id): Promise<readonly MembershipEntry[]>;
  append(fold: Id, entry: MembershipEntry): Promise<void>;
  clear(fold: Id): Promise<void>;
}

/** Everything another person needs to invite this account: their id, both public keys, signed by the signing key inside. */
export interface PublicKeyBundle {
  readonly accountId: string;
  readonly encPk: Uint8Array;
  readonly sigPk: Uint8Array;
  readonly selfSig: Uint8Array;
}

export type RemoteFailure = 'offline' | 'forbidden' | 'conflict' | 'not_found' | 'rate_limited' | 'rejected';
export type Remote<T> = Promise<Result<T, { readonly code: RemoteFailure; readonly message: string }>>;

/** The service's side of sharing (contracts/sync-api.openapi.yaml: membership). It carries entries and grants and checks nothing a client does not. */
export interface MembershipRemote {
  /** The Folds the account belongs to, as the service sees them. */
  folds(): Remote<readonly Id[]>;
  /** Entries after index `after` (-1 for all), and the index of the last entry the service holds (-1 when it holds none). */
  fetchLog(fold: Id, after: number): Remote<{ readonly entries: readonly MembershipEntry[]; readonly head: number }>;
  /** Appends one entry (and the grants that go with it). `conflict` means the log moved: fetch it and try again. */
  postLog(fold: Id, entry: MembershipEntry, grants: readonly Uint8Array[]): Remote<true>;
  /** Appends an `add_member` entry and tells the invitee, naming only the sender (FR-107). */
  invite(fold: Id, entry: MembershipEntry, grants: readonly Uint8Array[], notifyEmail?: string): Remote<true>;
  fetchGrants(fold: Id): Remote<readonly Uint8Array[]>;
  lookup(email: string): Remote<PublicKeyBundle>;
  publicKeys(account: string): Remote<PublicKeyBundle>;
}

export interface GrantInfo {
  readonly fold: Id;
  readonly epoch: number;
  readonly member: string;
  readonly role: RoleCode;
  readonly grantedBy: string;
}

export interface SharingCrypto {
  readonly log: LogCrypto;
  signEntry(draft: Omit<MembershipEntry, 'sig'>, signingKey: Secret): Promise<MembershipEntry>;
  verifyBundle(bundle: PublicKeyBundle): Promise<boolean>;
  fingerprint(encPk: Uint8Array, sigPk: Uint8Array): Uint8Array;
  /** Seals a Fold key for one member and epoch, signed by the granter (ARCH 7.2). */
  sealGrant(args: {
    fold: Id; epoch: number; role: RoleCode; member: string; grantedBy: string; recipientEncPk: Uint8Array; foldKey: Secret; signingKey: Secret;
  }): Promise<Uint8Array>;
  /** Reads what a grant says without opening it; undefined if it is not a grant. */
  readGrant(bytes: Uint8Array): GrantInfo | undefined;
  /** Checks the signature, then opens the Fold key. Undefined if either fails. The caller wipes the result. */
  openGrant(args: { grant: Uint8Array; encSk: Secret; granterSigPk: Uint8Array }): Promise<Secret | undefined>;
  /** A fresh Fold key. */
  newFoldKey(): Secret;
}

/** This account's keys, available only while the app is unlocked. */
export interface AccountIdentity {
  readonly accountId: string;
  readonly email: string;
  readonly encPk: Uint8Array;
  readonly sigPk: Uint8Array;
  readonly encSk: Secret;
  readonly sigSk: Secret;
}

/** This account's registered devices, as the service lists them. */
export interface OwnDevice {
  readonly id: Id;
  readonly sigPk: Uint8Array;
  readonly revoked: boolean;
}

export interface SharingKeyring {
  epochs(fold: Id): Promise<readonly number[]>;
  /** The Fold key of an epoch. The holder keeps ownership; callers must not wipe it. */
  key(fold: Id, epoch: number): Promise<Secret | undefined>;
  /** Stores a Fold key that arrived from outside. The keyring takes ownership of `key`. */
  importFoldKey(fold: Id, epoch: number, key: Secret): Promise<void>;
}
