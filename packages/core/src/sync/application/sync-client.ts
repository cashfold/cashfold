import type { Id } from '../../shared-kernel/id';
import type { ClockPort, OpLogStore, PushOutcome, QuarantineReason, SealedOp, SyncCursorPort, TransportPort } from '../ports/index';
import type { RemoteOutcome, WritePath } from './write-path';

export const MAX_OPS_PER_PUSH = 256;
export const MAX_PUSH_BYTES = 4 * 1024 * 1024;
export const PULL_PAGE = 500;
/** Per-op overhead counted against the push size cap, on top of the ciphertext (envelope fields and signature). */
const ENVELOPE_OVERHEAD = 200;

export type SyncFailure =
  | 'offline'
  /** The relay refused an op this device authored (bad signature, unknown epoch, too large, not authorised). */
  | 'rejected'
  /** The relay served a device's ops with one missing: it dropped something, or the log was truncated. */
  | 'gap'
  /** An op is signed by a device this one does not know yet (newly added on another device): learn the device, then try again. */
  | 'unknown_signer'
  | 'failed';

export interface SyncReport {
  readonly pushed: number;
  readonly pulled: number;
  readonly applied: number;
  readonly duplicates: number;
  readonly quarantined: number;
  readonly ignored: number;
  readonly head: bigint;
  /** Ops of this device the relay refused, with its reason; they stay pending. */
  readonly rejectedOps: readonly { readonly op: Id; readonly reason: NonNullable<PushOutcome['error']> }[];
  readonly failure?: SyncFailure;
}

export interface SyncClientDeps {
  readonly oplog: OpLogStore;
  readonly writePath: WritePath;
  readonly transport: TransportPort;
  readonly cursors: SyncCursorPort;
  readonly clock: ClockPort;
  /** Called for every op that changed local state, so caches and screens can refresh. */
  readonly onApplied?: (fold: Id, outcome: Extract<RemoteOutcome, { kind: 'applied' }>) => void;
}

export interface SyncClient {
  /** One round: push what is pending, then pull and apply what is new. Safe to call at any time and to repeat. */
  syncFold(fold: Id): Promise<SyncReport>;
}

// Quarantine reasons that mean the op was authentic and complete but unusable here: its sequence number is still used up.
const CONSUMES_SEQ: ReadonlySet<QuarantineReason> = new Set(['clock_ahead', 'invalid_op', 'schema_unsupported', 'purged_record']);

const failureOf = (e: unknown): SyncFailure => ((e as { kind?: unknown } | null)?.kind === 'offline' ? 'offline' : 'failed');

export function createSyncClient(deps: SyncClientDeps): SyncClient {
  const { oplog, writePath, transport, cursors } = deps;

  async function push(fold: Id, report: Mutable): Promise<boolean> {
    const pending = await oplog.listPending(fold);
    for (let at = 0; at < pending.length; ) {
      const batch: SealedOp[] = [];
      let bytes = 0;
      while (at < pending.length && batch.length < MAX_OPS_PER_PUSH) {
        const next = pending[at]!.sealed;
        const size = next.blob.length + ENVELOPE_OVERHEAD;
        if (batch.length > 0 && bytes + size > MAX_PUSH_BYTES) break;
        batch.push(next);
        bytes += size;
        at++;
      }
      let outcomes: readonly PushOutcome[];
      try {
        outcomes = await transport.push(fold, batch);
      } catch (e) {
        report.failure = failureOf(e);
        return false;
      }
      const byOp = new Map(outcomes.map((o) => [o.op, o]));
      const accepted: Id[] = [];
      let stopped = false;
      for (const sealed of batch) {
        const o = byOp.get(sealed.op);
        if (o === undefined) {
          report.failure = 'failed';
          stopped = true;
          break;
        }
        if (o.error === undefined || o.error === 'duplicate') {
          accepted.push(sealed.op);
        } else {
          // Later ops of this device depend on this one (sequence order), so nothing after it can be accepted either.
          report.rejectedOps.push({ op: sealed.op, reason: o.error });
          report.failure = o.error === 'seq_gap' ? 'gap' : 'rejected';
          stopped = true;
          break;
        }
      }
      if (accepted.length > 0) await oplog.markPushed(fold, accepted);
      report.pushed += accepted.filter((op) => byOp.get(op)?.error === undefined).length;
      if (stopped) return false;
    }
    return true;
  }

  async function pull(fold: Id, report: Mutable): Promise<void> {
    const start = await cursors.get(fold);
    let cursor = start.serverSeq;
    const { fromSnapshot } = start;
    // The highest sequence number accounted for per device: stored ops, plus authentic ops set aside for another reason.
    const accounted = new Map<Id, bigint>();
    const accountedFor = async (dev: Id): Promise<bigint> => {
      const known = accounted.get(dev);
      if (known !== undefined) return known;
      let high = await oplog.lastSeq(fold, dev);
      for (const q of await oplog.listQuarantined(fold)) if (q.sealed.dev === dev && CONSUMES_SEQ.has(q.reason) && q.sealed.seq > high) high = q.sealed.seq;
      accounted.set(dev, high);
      return high;
    };

    for (let retried = false; ; ) {
      let page;
      try {
        page = await transport.pull(fold, cursor, PULL_PAGE);
      } catch (e) {
        report.failure = failureOf(e);
        return;
      }
      report.head = page.head;
      // The relay's order is not trusted: ops are never skipped because a later one was seen first, only because they lie
      // at or below where this page started.
      const pageStart = cursor;
      let gapAt: bigint | undefined;
      let stalled = false;
      for (const { serverSeq, sealed } of page.ops) {
        if (serverSeq <= pageStart) continue; // a relay that repeats itself costs nothing
        report.pulled++;
        if (!(await oplog.has(fold, sealed.op))) {
          const high = await accountedFor(sealed.dev);
          const firstSeen = high === 0n && fromSnapshot;
          if (sealed.seq > high + 1n && !firstSeen) {
            gapAt = serverSeq;
            break;
          }
        }
        const r = await writePath.applyRemote(sealed);
        if (!r.ok) continue;
        switch (r.value.kind) {
          case 'applied':
            report.applied++;
            accounted.set(sealed.dev, sealed.seq > (accounted.get(sealed.dev) ?? 0n) ? sealed.seq : accounted.get(sealed.dev)!);
            deps.onApplied?.(fold, r.value);
            break;
          case 'duplicate':
            report.duplicates++;
            break;
          case 'ignored':
            report.ignored++;
            break;
          case 'quarantined':
            if (r.value.reason === 'unknown_signer') {
              // Not the op's fault: nothing is passed over until the signer is known, then it is applied like any other.
              stalled = true;
              break;
            }
            report.quarantined++;
            if (CONSUMES_SEQ.has(r.value.reason)) accounted.set(sealed.dev, sealed.seq > (accounted.get(sealed.dev) ?? 0n) ? sealed.seq : accounted.get(sealed.dev)!);
            break;
        }
        if (stalled) break;
        if (serverSeq > cursor) cursor = serverSeq;
      }
      if (stalled) {
        await cursors.set(fold, { serverSeq: pageStart, fromSnapshot });
        report.failure = 'unknown_signer';
        return;
      }
      if (gapAt !== undefined) cursor = pageStart; // nothing is passed over until the missing op arrives
      await cursors.set(fold, { serverSeq: cursor, fromSnapshot });
      if (gapAt !== undefined) {
        // Ask once more from where we stopped: a page boundary or a transient fault resolves; a dropped op does not.
        if (retried) {
          report.failure = 'gap';
          return;
        }
        retried = true;
        accounted.clear();
        continue;
      }
      retried = false;
      if (!page.more || page.ops.length === 0) return;
    }
  }

  return {
    async syncFold(fold) {
      const report: Mutable = { pushed: 0, pulled: 0, applied: 0, duplicates: 0, quarantined: 0, ignored: 0, head: 0n, rejectedOps: [] };
      // Pushing first means a device that was offline publishes its work before it learns of others'; either order converges.
      if (await push(fold, report)) await pull(fold, report);
      else if (report.failure === 'rejected' || report.failure === 'gap') await pull(fold, report).catch(() => undefined);
      return report;
    },
  };
}

type Mutable = {
  -readonly [K in keyof SyncReport]: K extends 'rejectedOps' ? { op: Id; reason: NonNullable<PushOutcome['error']> }[] : SyncReport[K];
};
