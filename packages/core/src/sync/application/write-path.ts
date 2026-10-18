import { newIdV7, type Id } from '../../shared-kernel/id.js';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result.js';
import { receive, tick, ZERO_HLC, type Hlc } from '../domain/hlc.js';
import {
  applyOpInto, mergeRecords, recordFromOp, validateOp,
  type FieldValue, type GroupRegistry, type MergeError, type Op, type RecordState, type SetDelta,
} from '../domain/merge.js';
import type {
  ClockPort, KeyStorePort, OpLogStore, OpSealerPort, ProjectionStore, QuarantineReason, RandomPort, SealedOp, SealFailureKind, WireOp,
} from '../ports/index.js';

/** Schema version stamped on new ops. Older versions are upcast on read (see upcasters.ts). */
export const SCHEMA_VERSION = 1;

/** What a command hands to the write path: the patches for one record. */
export interface OpDraft {
  readonly fold: Id;
  readonly rec: Id;
  readonly table: number;
  readonly fields: ReadonlyMap<number, FieldValue>;
  readonly sets: ReadonlyMap<number, SetDelta>;
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
  readonly upcast?: (op: WireOp) => WireOp;
}

export interface WritePath {
  /** Local command -> op: stamp, validate, seal, append and project in one transaction. */
  submit(draft: OpDraft): Promise<Result<Applied, WriteError>>;
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
  const upcast = deps.upcast ?? ((op: WireOp) => op);
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
    submit: (draft) =>
      serial(async () => {
        const result = await projections.transaction(async (): Promise<Result<{ applied: Applied; hlc: Hlc }, WriteError>> => {
          const epoch = await keys.currentEpoch(draft.fold);
          if (epoch === undefined) return err('no_key', 'This device holds no key for the Fold');
          const stamped = tick(await clockFor(draft.fold), clock.nowMs());
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
          await oplog.append({ sealed, origin: 'local', pushed: false });
          const { before, after } = await project(op, draft.fold);
          return ok({ applied: { op, sealed, before, after }, hlc: stamped.value });
        });
        if (!result.ok) return result;
        clocks.set(draft.fold, result.value.hlc);
        return ok(result.value.applied);
      }),

    applyRemote: (sealed) =>
      serial(async () => {
        const outcome = await projections.transaction(async (): Promise<{ result: RemoteOutcome; hlc?: Hlc }> => {
          if (await oplog.has(sealed.fold, sealed.op)) return { result: { kind: 'duplicate' } };

          const quarantine = async (reason: QuarantineReason): Promise<{ result: RemoteOutcome }> => {
            await oplog.quarantine({ sealed, reason, atMs: clock.nowMs() });
            return { result: { kind: 'quarantined', reason } };
          };

          let wire: WireOp;
          try {
            wire = upcast(await sealer.open(sealed));
          } catch (e) {
            const kind = sealFailureKind(e);
            if (kind === undefined) throw e;
            return quarantine(kind);
          }

          const merged = receive(await clockFor(sealed.fold), wire.hlc, clock.nowMs());
          if (!merged.ok) return quarantine('clock_ahead');
          const op = toMergeOp(wire);
          if (!validateOp(op, groups).ok) return quarantine('invalid_op');

          await oplog.append({ sealed, origin: 'remote', pushed: true });
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
            try {
              const op = toMergeOp(upcast(await sealer.open(stored.sealed)));
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
