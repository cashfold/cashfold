import type { Id } from '../shared-kernel/id';
import { compareHlc, type Hlc } from '../sync/domain/hlc';
import type { RecordState } from '../sync/domain/merge';
import type { OpLogStore, ProjectionStore, QuarantinedOp, StoredOp } from '../sync/ports/index';

/** In-memory op log and projection store with snapshot-and-rollback transactions. For tests only. */
export interface MemoryStores {
  readonly oplog: OpLogStore;
  readonly projections: ProjectionStore;
  /** Makes the next `putRecord` throw, to exercise transaction rollback. */
  failNextProjectionWrite(): void;
  /** Flips a byte in the stored blob of the op at `index` (insertion order), simulating storage corruption. */
  corruptStoredOp(index: number): void;
}

const key = (fold: Id, op: Id) => `${fold}|${op}`;

export function createMemoryStores(): MemoryStores {
  let ops: StoredOp[] = [];
  let quarantined: QuarantinedOp[] = [];
  let records = new Map<Id, Map<Id, RecordState>>();
  let failNext = false;

  const oplog: OpLogStore = {
    async has(fold, op) {
      return ops.some((o) => key(o.sealed.fold, o.sealed.op) === key(fold, op));
    },
    async append(op) {
      if (ops.some((o) => key(o.sealed.fold, o.sealed.op) === key(op.sealed.fold, op.sealed.op))) return 'duplicate';
      if (ops.some((o) => o.sealed.fold === op.sealed.fold && o.sealed.dev === op.sealed.dev && o.sealed.seq === op.sealed.seq)) return 'seq_conflict';
      ops = [...ops, op];
      return 'inserted';
    },
    async lastSeq(fold, dev) {
      return ops.filter((o) => o.sealed.fold === fold && o.sealed.dev === dev).reduce((max, o) => (o.sealed.seq > max ? o.sealed.seq : max), 0n);
    },
    async maxHlc(fold) {
      let best: Hlc | undefined;
      for (const o of ops) if (o.sealed.fold === fold && (best === undefined || compareHlc(o.sealed.hlc, best) > 0)) best = o.sealed.hlc;
      return best;
    },
    async list(fold) {
      return ops.filter((o) => o.sealed.fold === fold);
    },
    async listPending(fold) {
      return ops.filter((o) => o.sealed.fold === fold && o.origin === 'local' && !o.pushed).sort((a, b) => (a.sealed.seq < b.sealed.seq ? -1 : 1));
    },
    async markPushed(fold, ids) {
      const set = new Set(ids);
      ops = ops.map((o) => (o.sealed.fold === fold && set.has(o.sealed.op) ? { ...o, pushed: true } : o));
    },
    async quarantine(entry) {
      // One entry per op; a later verdict replaces the earlier one.
      quarantined = [...quarantined.filter((q) => key(q.sealed.fold, q.sealed.op) !== key(entry.sealed.fold, entry.sealed.op)), entry];
    },
    async listQuarantined(fold) {
      return quarantined.filter((q) => q.sealed.fold === fold);
    },
  };

  const projections: ProjectionStore = {
    async transaction(fn) {
      const saved = { ops, quarantined, records: new Map([...records].map(([f, m]) => [f, new Map(m)])) };
      try {
        return await fn();
      } catch (e) {
        ({ ops, quarantined, records } = saved);
        throw e;
      }
    },
    async getRecord(fold, rec) {
      return records.get(fold)?.get(rec);
    },
    async putRecord(fold, rec, state) {
      if (failNext) {
        failNext = false;
        throw new Error('disk full');
      }
      const m = records.get(fold) ?? new Map<Id, RecordState>();
      m.set(rec, state);
      records.set(fold, m);
    },
    async listRecords(fold) {
      return new Map(records.get(fold) ?? []);
    },
    async clear(fold) {
      records.delete(fold);
    },
  };

  return {
    oplog,
    projections,
    failNextProjectionWrite: () => {
      failNext = true;
    },
    corruptStoredOp(index) {
      const target = ops[index];
      if (target === undefined) throw new RangeError('no such op');
      const blob = Uint8Array.from(target.sealed.blob);
      blob[20] = blob[20]! ^ 0xff;
      ops = ops.map((o, i) => (i === index ? { ...o, sealed: { ...o.sealed, blob } } : o));
    },
  };
}
