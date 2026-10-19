import { newIdV7, type Id } from '../../shared-kernel/id';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import { receive, tick, ZERO_HLC, type Hlc } from '../domain/hlc';
import {
  applyOpInto, mergeRecords, recordFromOp, validateOp,
  type FieldValue, type GroupRegistry, type MergeError, type Op, type RecordState, type SetDelta,
} from '../domain/merge';
import { createUpcasters, type Upcasters } from './upcasters';
import type {
  ClockPort, KeyStorePort, OpLogStore, OpSealerPort, ProjectionStore, QuarantineReason, RandomPort, SealedOp, SealFailureKind, WireOp,
} from '../ports/index';

/** Schema version stamped on new ops. Older versions are upcast on read (see upcasters.ts). */
export const SCHEMA_VERSION = 1;

/** What a command hands to the write path: the patches for one record. */
export interface OpDraft {
  readonly fold: Id;
  readonly rec: Id;
  readonly table: number;
  readonly fields: ReadonlyMap<number, FieldValue>;
  readonly sets: ReadonlyMap<number, SetDelta>;
  /**
   * Stamps the op with this clock instead of the device's next one. Only a baseline republished for a new member does this,
   * so each field keeps the clock that last wrote it and the op changes nothing for members who already have it.
   */
  readonly hlc?: Hlc;
}

export type WriteError = MergeError | DomainError<'no_key' | 'clock_overflow'>;

export interface Applied {
  readonly op: Op;
  readonly sealed: SealedOp;
  readonly before: RecordState | undefined;
  readonly after: RecordState;
}

export type RemoteOutcome =
  | ({ readonly kind: 'applied' } & Applied)
  | { readonly kind: 'duplicate' }
  /** For a Fold this device holds no key for: dropped, not stored (a hostile relay could otherwise fill the quarantine). */
  | { readonly kind: 'ignored'; readonly reason: 'unknown_fold' }
  | { readonly kind: 'quarantined'; readonly reason: QuarantineReason };

export interface RebuildReport {
  readonly opsReplayed: number;
  readonly recordsRebuilt: number;
  /** Ops that no longer open or validate. They are skipped, not fatal. */
  readonly failed: number;
}

export interface WritePathDeps {
  readonly oplog: OpLogStore;
  readonly projections: ProjectionStore;
  readonly sealer: OpSealerPort;
  readonly clock: ClockPort;
  readonly random: RandomPort;
  readonly keys: KeyStorePort;
  readonly groups: GroupRegistry;
  /** Brings an op written under an older schema up to the current one before it is merged. */
  readonly upcasters?: Upcasters;
  /**
   * Whether the op's author was allowed to write at the time the op says it was written (the membership log decides, FR-085).
   * `unknown_signer` means the log has not yet told this device who owns the signing device: the op is not stored, so it can
   * be applied cleanly once the log is current.
   */
  readonly authorise?: (op: WireOp) => Promise<'ok' | 'unauthorised' | 'unknown_signer'>;
}

export interface WritePath {
  /** Local command -> op: stamp, validate, seal, append and project in one transaction. */
  submit(draft: OpDraft): Promise<Result<Applied, WriteError>>;
  /** Several drafts in one atomic transaction: all are written or none. Stamped in order. */
  submitMany(drafts: readonly OpDraft[]): Promise<Result<readonly Applied[], WriteError>>;
  /** Remote op -> verify, decrypt, validate, append and project, through the same code as `submit`. */
  applyRemote(sealed: SealedOp): Promise<Result<RemoteOutcome, never>>;
  /** Replays the op log into empty projections. */
  rebuild(fold: Id): Promise<Result<RebuildReport, never>>;
}

const SEAL_KINDS: ReadonlySet<string> = new Set<SealFailureKind>(['unknown_signer', 'bad_signature', 'unknown_key', 'decrypt_failed', 'malformed']);

function sealFailureKind(e: unknown): SealFailureKind | undefined {
  const kind = (e as { kind?: unknown } | null)?.kind;
  return typeof kind === 'string' && SEAL_KINDS.has(kind) ? (kind as SealFailureKind) : undefined;
}

export function toMergeOp(w: WireOp): Op {
  return { id: w.op, rec: w.rec, dev: w.dev, hlc: w.hlc, table: w.table, fields: w.fields, sets: w.sets };
}

export function createWritePath(deps: WritePathDeps): WritePath {
  const { oplog, projections, sealer, clock, random, keys, groups } = deps;
  const upcasters = deps.upcasters ?? createUpcasters(SCHEMA_VERSION, new Map());
  const clocks = new Map<Id, Hlc>();

  // One command at a time: the Core Worker is the single writer, and commands must not interleave across awaits.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function clockFor(fold: Id): Promise<Hlc> {
    return clocks.get(fold) ?? (await oplog.maxHlc(fold)) ?? ZERO_HLC;
  }

  async function project(op: Op, fold: Id): Promise<{ before: RecordState | undefined; after: RecordState }> {
    const before = await projections.getRecord(fold, op.rec);
    const incoming = recordFromOp(op);
    const after = before === undefined ? incoming : mergeRecords(before, incoming);
    await projections.putRecord(fold, op.rec, after);
    return { before, after };
  }

  return {
    submitMany: (drafts) =>
      serial(async () => {
        const result = await projections.transaction(async (): Promise<Result<{ applied: Applied[]; clocks: Map<Id, Hlc> }, WriteError>> => {
          const next = new Map<Id, Hlc>();
          const applied: Applied[] = [];
          for (const draft of drafts) {
            const epoch = await keys.currentEpoch(draft.fold);
            if (epoch === undefined) return err('no_key', 'This device holds no key for the Fold');
            const stamped = draft.hlc !== undefined ? ok(draft.hlc) : tick(next.get(draft.fold) ?? (await clockFor(draft.fold)), clock.nowMs());
            if (!stamped.ok) return err(stamped.error.code, stamped.error.message);

            const dev = keys.deviceId();
            const wire: WireOp = {
              fold: draft.fold, op: newIdV7(clock.nowMs(), (n) => random.bytes(n)), rec: draft.rec, dev,
              seq: (await oplog.lastSeq(draft.fold, dev)) + 1n, hlc: stamped.value, epoch, schema: SCHEMA_VERSION,
              table: draft.table, fields: draft.fields, sets: draft.sets,
            };
            const op = toMergeOp(wire);
            const valid = validateOp(op, groups);
            if (!valid.ok) return valid;

            const sealed = await sealer.seal(wire);
            if ((await oplog.append({ sealed, origin: 'local', pushed: false })) !== 'inserted') throw new Error('local op was not inserted: sequence bookkeeping is corrupt');
            const { before, after } = await project(op, draft.fold);
            applied.push({ op, sealed, before, after });
            if (draft.hlc === undefined) next.set(draft.fold, stamped.value);
          }
          return ok({ applied, clocks: next });
        });
        if (!result.ok) return result;
        for (const [fold, hlc] of result.value.clocks) clocks.set(fold, hlc);
        return ok(result.value.applied);
      }),

    async submit(draft) {
      const result = await this.submitMany([draft]);
      return result.ok ? ok(result.value[0]!) : result;
    },

    applyRemote: (sealed) =>
      serial(async () => {
        const outcome = await projections.transaction(async (): Promise<{ result: RemoteOutcome; hlc?: Hlc }> => {
          if (await keys.currentEpoch(sealed.fold) === undefined) return { result: { kind: 'ignored', reason: 'unknown_fold' } };
          if (await oplog.has(sealed.fold, sealed.op)) return { result: { kind: 'duplicate' } };

          const quarantine = async (reason: QuarantineReason): Promise<{ result: RemoteOutcome }> => {
            await oplog.quarantine({ sealed, reason, atMs: clock.nowMs() });
            return { result: { kind: 'quarantined', reason } };
          };

          // A record that was purged (30 days after deletion) is gone for good. An op that arrives late for it cannot be
          // applied; it is kept for the user to see rather than silently dropped (FR-052).
          if (await projections.isPurged(sealed.fold, sealed.rec)) return quarantine('purged_record');

          let opened: WireOp;
          try {
            opened = await sealer.open(sealed);
          } catch (e) {
            const kind = sealFailureKind(e);
            if (kind === undefined) throw e;
            // An unknown signer is usually a device added moments ago whose key this device has not learned yet: the op is
            // reported, not stored, so it can be applied cleanly once the key is known.
            if (kind === 'unknown_signer') return { result: { kind: 'quarantined', reason: kind } };
            return quarantine(kind);
          }
          const upcast = upcasters.upcast(opened);
          if (!upcast.ok) return quarantine('schema_unsupported');
          const wire = upcast.value;

          if (deps.authorise !== undefined) {
            const verdict = await deps.authorise(wire);
            if (verdict === 'unknown_signer') return { result: { kind: 'quarantined', reason: 'unknown_signer' } };
            if (verdict === 'unauthorised') return quarantine('unauthorised');
          }

          const merged = receive(await clockFor(sealed.fold), wire.hlc, clock.nowMs());
          if (!merged.ok) return quarantine('clock_ahead');
          const op = toMergeOp(wire);
          if (!validateOp(op, groups).ok) return quarantine('invalid_op');

          const stored = await oplog.append({ sealed, origin: 'remote', pushed: true });
          if (stored === 'duplicate') return { result: { kind: 'duplicate' } };
          if (stored === 'seq_conflict') return quarantine('seq_conflict');
          const { before, after } = await project(op, sealed.fold);
          return { result: { kind: 'applied', op, sealed, before, after }, hlc: merged.value };
        });
        if (outcome.hlc !== undefined) clocks.set(sealed.fold, outcome.hlc);
        return ok(outcome.result);
      }),

    rebuild: (fold) =>
      serial(async () => {
        const report = await projections.transaction(async (): Promise<RebuildReport> => {
          await projections.clear(fold);
          const state = new Map<Id, RecordState>();
          let replayed = 0;
          let failed = 0;
          for (const stored of await oplog.list(fold)) {
            if (await projections.isPurged(fold, stored.sealed.rec)) continue; // payload scrubbed; nothing to replay
            try {
              const upcast = upcasters.upcast(await sealer.open(stored.sealed));
              if (!upcast.ok) throw Object.assign(new Error('unsupported schema'), { kind: 'malformed' });
              const op = toMergeOp(upcast.value);
              if (!validateOp(op, groups).ok) throw Object.assign(new Error('invalid op'), { kind: 'malformed' });
              applyOpInto(state, op);
              replayed++;
            } catch (e) {
              if (sealFailureKind(e) === undefined) throw e;
              failed++;
            }
          }
          for (const [rec, record] of state) await projections.putRecord(fold, rec, record);
          return { opsReplayed: replayed, recordsRebuilt: state.size, failed };
        });
        return ok(report);
      }),
  };
}
