// The relay's persistence port. It holds ciphertext and routing metadata only (ARCH 9.7): nothing here can decrypt
// an op, a snapshot or a key set. Two implementations satisfy the same contract tests: memory (unit tests and quick local
// runs) and PostgreSQL (production, integration tests).

export type Bytes = Uint8Array;

export interface KdfRecord {
  readonly kdf: 'argon2id' | 'pbkdf2-hmac-sha256';
  readonly mKib?: number;
  readonly t?: number;
  readonly p?: number;
  readonly iter?: number;
  readonly encSalt: Bytes;
}

export interface AccountRow {
  readonly accountId: string;
  readonly emailHmac: Bytes;
  /** Kept only to deliver mail (verification, invitations). Never used to look an account up. */
  readonly email: string;
  readonly authSalt: Bytes;
  readonly kdf: KdfRecord;
  readonly srpVerifier: Bytes;
  readonly keyset: Bytes;
  readonly failCount: number;
  readonly lockedUntilMs: number | null;
  readonly emailVerifiedAtMs: number | null;
  readonly discoverable: boolean;
  readonly createdAtMs: number;
  /** The account's signature over its own public key bundle, kept so others can be given it (FR-106). Null if the client sent none. */
  readonly bundleSig: Bytes | null;
}

export type NewAccount = Omit<AccountRow, 'failCount' | 'lockedUntilMs' | 'emailVerifiedAtMs' | 'createdAtMs' | 'bundleSig'> & { readonly createdAtMs: number; readonly bundleSig?: Bytes | null };

/** The optional second way into an account (ARCH 6.8): a verifier for the Recovery Key and the key set's private keys wrapped under it. */
export interface RecoveryRow {
  /** Names the credential; derived from the Recovery Key, reveals nothing. */
  readonly uuid: Bytes;
  readonly authSalt: Bytes;
  readonly srpVerifier: Bytes;
  readonly wrapped: Bytes;
}

export interface MemberRow {
  /** 1 owner, 2 editor, 3 viewer. */
  readonly role: number;
  /** The first key epoch this member may be sent ops for (FR-102). */
  readonly fromEpoch: number;
  readonly removedAtMs: number | null;
}

export interface DeviceRow {
  readonly devId: Bytes;
  readonly accountId: string;
  readonly sigPk: Bytes;
  readonly labelCt: Bytes | null;
  readonly createdAtMs: number;
  readonly revokedAtMs: number | null;
}

export interface OpRow {
  readonly opId: Bytes;
  readonly recId: Bytes;
  readonly devId: Bytes;
  readonly devSeq: bigint;
  readonly hlcWall: number;
  readonly hlcCtr: number;
  readonly epoch: number;
  readonly schemaVer: number;
  readonly blob: Bytes;
  readonly sig: Bytes;
}

export interface StoredOp extends OpRow {
  readonly serverSeq: bigint;
}

export type PushOutcome =
  | { readonly op: Bytes; readonly status: 'stored'; readonly serverSeq: bigint }
  | { readonly op: Bytes; readonly status: 'duplicate'; readonly serverSeq: bigint }
  | { readonly op: Bytes; readonly status: 'seq_gap' | 'seq_conflict' };

export interface SnapshotRow {
  readonly foldId: Bytes;
  readonly atSeq: bigint;
  readonly epoch: number;
  readonly blob: Bytes;
  readonly sig: Bytes;
}

export interface RateTableRow {
  readonly asOfMs: number;
  readonly base: string;
  readonly source: string;
  /** Currency code to decimal string, exactly as published. */
  readonly rates: Readonly<Record<string, string>>;
}

export interface Store {
  readonly accounts: {
    /** `email_taken` when the address (by MAC) is registered, `id_taken` when the account id is. */
    create(row: NewAccount): Promise<'ok' | 'email_taken' | 'id_taken'>;
    byEmailHmac(hmac: Bytes): Promise<AccountRow | undefined>;
    byId(accountId: string): Promise<AccountRow | undefined>;
    /** Replaces verifier, salt, KDF and key set in one step (password or Secret Key change). */
    replaceCredentials(accountId: string, next: Pick<AccountRow, 'authSalt' | 'kdf' | 'srpVerifier' | 'keyset'>): Promise<void>;
    recordFailure(accountId: string, lockedUntilMs: number | null): Promise<number>;
    clearFailures(accountId: string): Promise<void>;
    setEmailVerified(accountId: string, atMs: number): Promise<void>;
    setDiscoverable(accountId: string, value: boolean): Promise<void>;
    /** Removes the account, its devices and grants, and records a tombstone so devices learn of it (410). */
    remove(accountId: string, atMs: number): Promise<void>;
    isTombstoned(accountId: string): Promise<boolean>;
  };
  /** At most one recovery credential per account; it goes with the account. */
  readonly recovery: {
    get(accountId: string): Promise<RecoveryRow | undefined>;
    put(accountId: string, row: RecoveryRow): Promise<void>;
    remove(accountId: string): Promise<void>;
  };
  readonly devices: {
    add(row: DeviceRow): Promise<'ok' | 'exists'>;
    list(accountId: string): Promise<readonly DeviceRow[]>;
    get(devId: Bytes): Promise<DeviceRow | undefined>;
    revoke(accountId: string, devId: Bytes, atMs: number): Promise<boolean>;
    /** Replaces the encrypted label of one of the account's live devices. */
    setLabel(accountId: string, devId: Bytes, labelCt: Bytes | null): Promise<boolean>;
  };
  readonly emailVerification: {
    put(accountId: string, tokenHash: Bytes, expiresAtMs: number): Promise<void>;
    /** Marks a live, unused token used and returns the account it belongs to. */
    consume(tokenHash: Bytes, nowMs: number): Promise<string | undefined>;
  };
  readonly folds: {
    create(foldId: Bytes, owner: string, atMs: number): Promise<'ok' | 'exists'>;
    list(accountId: string): Promise<ReadonlyArray<{ foldId: Bytes; headSeq: bigint }>>;
    /** The caller's role (1 owner, 2 editor, 3 viewer), or undefined if not a current member. */
    roleOf(foldId: Bytes, accountId: string): Promise<number | undefined>;
    /** The membership row including a member who has since left or been removed (they may still read the log to learn it). */
    member(foldId: Bytes, accountId: string): Promise<MemberRow | undefined>;
    /** Adds a member, or brings back one who left, with a fresh role and starting epoch. */
    addMember(foldId: Bytes, accountId: string, role: number, fromEpoch: number): Promise<void>;
    setRole(foldId: Bytes, accountId: string, role: number): Promise<void>;
    removeMember(foldId: Bytes, accountId: string, atMs: number): Promise<void>;
    members(foldId: Bytes): Promise<readonly string[]>;
    remove(foldId: Bytes): Promise<void>;
  };
  /** The membership log of each Fold: signed, hash-chained entries stored exactly as the clients wrote them (ARCH 7.3). */
  readonly log: {
    /** Appends entry `idx`; `conflict` unless it is the next index. */
    append(foldId: Bytes, idx: number, entry: Bytes, hash: Bytes): Promise<'ok' | 'conflict'>;
    /** Entries after index `after` (-1 for all), and the index of the last entry (-1 for an empty log). */
    list(foldId: Bytes, after: number): Promise<{ entries: readonly Bytes[]; head: number }>;
    last(foldId: Bytes): Promise<{ idx: number; hash: Bytes; entry: Bytes } | undefined>;
  };
  readonly grants: {
    /** Keeps the newest write for `(fold, member, epoch)`; a grant is replaced only by another for the same epoch. */
    put(foldId: Bytes, member: string, epoch: number, grant: Bytes): Promise<void>;
    /** Every grant addressed to `member`, oldest epoch first. */
    forMember(foldId: Bytes, member: string): Promise<readonly Bytes[]>;
  };
  readonly ops: {
    /** Atomic: assigns server_seq in order, enforces the per-device sequence, answers each op. Idempotent on op id. */
    push(foldId: Bytes, ops: readonly OpRow[]): Promise<readonly PushOutcome[]>;
    /** Ops after `after`. `minEpoch` withholds older ones from a member who joined later; it saves bandwidth and is not a security boundary. */
    pull(foldId: Bytes, after: bigint, limit: number, minEpoch?: number): Promise<{ ops: readonly StoredOp[]; head: bigint; more: boolean }>;
    head(foldId: Bytes): Promise<bigint>;
    /** Highest device sequence stored for the device in this Fold, or 0. */
    lastDevSeq(foldId: Bytes, devId: Bytes): Promise<bigint>;
  };
  readonly snapshots: {
    put(row: SnapshotRow): Promise<void>;
    get(foldId: Bytes): Promise<SnapshotRow | undefined>;
    /** Every Fold that has a snapshot: the ones a pruning sweep must look at. */
    folds(): Promise<Bytes[]>;
    /** A device confirms it holds everything up to `seq`. */
    acknowledge(foldId: Bytes, devId: Bytes, seq: bigint): Promise<void>;
    /** Deletes ops at or below the snapshot once every active device has acknowledged at least that far. Returns how many. */
    prune(foldId: Bytes): Promise<number>;
  };
  /** Sealed attachment pieces (FR-093). Immutable once stored; the relay sees sizes and nothing else. */
  readonly attachments: {
    /** `conflict` when a different piece is already stored at this place: a piece is written once. The same bytes again are accepted. */
    putChunk(foldId: Bytes, attId: Bytes, index: number, data: Bytes): Promise<'ok' | 'conflict'>;
    getChunk(foldId: Bytes, attId: Bytes, index: number): Promise<Bytes | undefined>;
    /** How many pieces the Fold holds in all, for its quota. */
    chunkCount(foldId: Bytes): Promise<number>;
  };
  readonly rates: {
    put(row: RateTableRow): Promise<void>;
    latest(): Promise<RateTableRow | undefined>;
  };
  close(): Promise<void>;
}
