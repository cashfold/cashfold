import type { Id } from '../../shared-kernel/id';
import type { Hlc } from '../domain/hlc';
import type { FieldValue, RecordState, SetDelta } from '../domain/merge';

/** An operation in the clear, as it passes through the sealer (signing and encryption happen behind `OpSealerPort`). */
export interface WireOp {
  readonly fold: Id;
  readonly op: Id;
  readonly rec: Id;
  readonly dev: Id;
  readonly seq: bigint;
  readonly hlc: Hlc;
  readonly epoch: number;
  readonly schema: number;
  readonly table: number;
  readonly fields: ReadonlyMap<number, FieldValue>;
  readonly sets: ReadonlyMap<number, SetDelta>;
}

/** The signed, encrypted form stored in the op log and sent to the relay. */
export interface SealedOp {
  readonly fold: Id;
  readonly op: Id;
  readonly rec: Id;
  readonly dev: Id;
  readonly seq: bigint;
  readonly hlc: Hlc;
  readonly epoch: number;
  readonly schema: number;
  readonly blob: Uint8Array;
  readonly sig: Uint8Array;
}

export type SealFailureKind = 'unknown_signer' | 'bad_signature' | 'unknown_key' | 'decrypt_failed' | 'malformed';

/**
 * Signs and encrypts outgoing ops, verifies and decrypts incoming ones. `open` checks the signature first,
 * then the AEAD tag, then parses. Failures reject with an Error carrying `kind: SealFailureKind`.
 */
export interface OpSealerPort {
  seal(op: WireOp): Promise<SealedOp>;
  open(sealed: SealedOp): Promise<WireOp>;
}

export interface StoredOp {
  readonly sealed: SealedOp;
  readonly origin: 'local' | 'remote';
  /** Local ops start unpushed; remote ops are born pushed. */
  readonly pushed: boolean;
}

export type QuarantineReason = SealFailureKind | 'clock_ahead' | 'invalid_op' | 'schema_unsupported' | 'seq_conflict' | 'purged_record';

export interface QuarantinedOp {
  readonly sealed: SealedOp;
  readonly reason: QuarantineReason;
  readonly atMs: number;
}

/** Append-only log of sealed ops: the source of truth the projections are rebuilt from. */
export interface OpLogStore {
  has(fold: Id, op: Id): Promise<boolean>;
  /**
   * `duplicate` leaves the log unchanged (idempotent on `(fold, op)`). `seq_conflict` means a *different* op already
   * uses this `(fold, dev, seq)`: the device equivocated, and the new op must not be stored or applied.
   */
  append(op: StoredOp): Promise<'inserted' | 'duplicate' | 'seq_conflict'>;
  /** Highest `seq` this device has used in the Fold, or 0n. */
  lastSeq(fold: Id, dev: Id): Promise<bigint>;
  maxHlc(fold: Id): Promise<Hlc | undefined>;
  /** All ops in insertion order. */
  list(fold: Id): Promise<readonly StoredOp[]>;
  /** Local ops not yet acknowledged by the relay, in `seq` order. */
  listPending(fold: Id): Promise<readonly StoredOp[]>;
  markPushed(fold: Id, ops: readonly Id[]): Promise<void>;
  quarantine(entry: QuarantinedOp): Promise<void>;
  listQuarantined(fold: Id): Promise<readonly QuarantinedOp[]>;
  /**
   * Erases the payload of every op about a record that has been purged (FR-052). The header stays: it keeps the
   * `(fold, op)` identity, so a re-delivered op is still a duplicate, and the device sequence number stays reserved.
   * Returns how many ops were scrubbed.
   */
  scrub(fold: Id, rec: Id): Promise<number>;
}

/**
 * Persists merged record state. The adapter maps a `RecordState` onto the domain tables and field clocks.
 * `transaction` brackets every OpLogStore and ProjectionStore call made inside it into one atomic unit.
 */
export interface ProjectionStore {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  getRecord(fold: Id, rec: Id): Promise<RecordState | undefined>;
  putRecord(fold: Id, rec: Id, state: RecordState): Promise<void>;
  listRecords(fold: Id): Promise<ReadonlyMap<Id, RecordState>>;
  /** Drops every projected row for the Fold (used by rebuild). Purge markers survive it. */
  clear(fold: Id): Promise<void>;
  /** Removes the record from every projection and remembers that it was purged, so late ops for it can be refused. */
  purgeRecord(fold: Id, rec: Id, atMs: number): Promise<void>;
  isPurged(fold: Id, rec: Id): Promise<boolean>;
}

export interface ClockPort {
  nowMs(): number;
}

export interface RandomPort {
  bytes(length: number): Uint8Array;
}

export interface KeyStorePort {
  deviceId(): Id;
  /** The epoch new ops are encrypted under, or undefined when this device holds no key for the Fold. */
  currentEpoch(fold: Id): Promise<number | undefined>;
}

export interface PushOutcome {
  readonly op: Id;
  readonly serverSeq?: bigint;
  readonly error?: 'bad_signature' | 'unauthorised' | 'seq_gap' | 'seq_conflict' | 'too_large' | 'unknown_epoch' | 'duplicate';
}

export interface PullResult {
  readonly ops: readonly { readonly serverSeq: bigint; readonly sealed: SealedOp }[];
  readonly head: bigint;
  readonly more: boolean;
}

export interface TransportPort {
  push(fold: Id, ops: readonly SealedOp[]): Promise<readonly PushOutcome[]>;
  pull(fold: Id, after: bigint, limit: number): Promise<PullResult>;
}

/** Where this device has got to in each Fold's relay log. Local to the device; never synced. */
export interface SyncCursorPort {
  /** `fromSnapshot` is true when the log below the cursor was replaced by a verified snapshot, so a device's first op need not be seq 1. */
  get(fold: Id): Promise<{ readonly serverSeq: bigint; readonly fromSnapshot: boolean }>;
  set(fold: Id, state: { readonly serverSeq: bigint; readonly fromSnapshot: boolean }): Promise<void>;
}
