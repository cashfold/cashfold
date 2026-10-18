import type { Id } from '../shared-kernel/id.js';
import type { FieldEntry, RecordState } from '../sync/domain/merge.js';
import type { OpLogStore, ProjectionStore, QuarantinedOp, SealedOp, StoredOp } from '../sync/ports/index.js';
import { id } from './world.js';

// A behavioural contract that every OpLogStore + ProjectionStore implementation must satisfy. Each case runs
// against the stores and returns a plain observation; the caller compares it with `expected`. Cases return data
// instead of asserting so the same contract can run inside a Web Worker (SQLite) and in Node (memory).

export interface ContractStores {
  readonly oplog: OpLogStore;
  readonly projections: ProjectionStore;
  /** Creates whatever must exist before a Fold can hold data (a `fold` row for the SQLite adapter). */
  prepareFold(fold: Id): Promise<void>;
}

export interface ContractCase {
  readonly name: string;
  run(stores: ContractStores): Promise<unknown>;
  readonly expected: unknown;
}

const FOLD_A = id(0xa1);
const FOLD_B = id(0xb1);
const DEV_1 = id(0xd1);
const DEV_2 = id(0xd2);

const bytes = (n: number, len = 8) => Uint8Array.from({ length: len }, (_, i) => (n + i) & 0xff);

export function sealed(n: number, over: Partial<SealedOp> = {}): SealedOp {
  return {
    fold: FOLD_A, op: id(0x1000 + n), rec: id(0x100 + (n % 3)), dev: DEV_1, seq: BigInt(n), hlc: { wallMs: 1_700_000_000_000 + n, ctr: n % 4 },
    epoch: 1, schema: 1, blob: bytes(n, 300), sig: bytes(n + 100, 64), ...over,
  };
}

const local = (s: SealedOp, pushed = false): StoredOp => ({ sealed: s, origin: 'local', pushed });
const remote = (s: SealedOp): StoredOp => ({ sealed: s, origin: 'remote', pushed: true });

function entry(n: number, value: FieldEntry['value'], dev = DEV_1): FieldEntry {
  return { hlc: { wallMs: 1_700_000_000_000 + n, ctr: n }, dev, opId: id(0x2000 + n), value };
}

/** A record exercising every field-value shape, set state and the table-conflict flag. */
export function richRecord(): RecordState {
  return {
    table: 6,
    tableConflict: true,
    fields: new Map<number, FieldEntry>([
      [1, entry(1, 'Coffee beans')],
      [2, entry(2, -9223372036854775808n)],
      [3, entry(3, 9223372036854775807n)],
      [4, entry(4, bytes(9, 16))],
      [5, entry(5, true)],
      [6, entry(6, null)],
      [7, entry(7, [1n, 'two', [3n], { deep: false }])],
      [8, entry(8, { nested: 5n, bytes: bytes(1, 4), list: ['a', 'b'] })],
      [65535, entry(9, false, DEV_2)],
    ]),
    sets: new Map([
      [20, { adds: new Map([[id(0x51), new Set([id(0x61), id(0x62)])], [id(0x52), new Set([id(0x63)])]]), removed: new Map([[id(0x51), new Set([id(0x61)])]]) }],
    ]),
  };
}

/** Normalises Sets and Maps so observations compare the same everywhere. */
export function plain(state: RecordState | undefined): unknown {
  if (state === undefined) return undefined;
  const setView = (m: ReadonlyMap<Id, ReadonlySet<Id>>) => [...m].map(([k, v]) => [k, [...v].sort()]).sort();
  return {
    table: state.table,
    tableConflict: state.tableConflict,
    fields: [...state.fields].sort(([a], [b]) => a - b),
    sets: [...state.sets].sort(([a], [b]) => a - b).map(([f, s]) => [f, setView(s.adds), setView(s.removed)]),
  };
}

export const storeContract: readonly ContractCase[] = [
  {
    name: 'append is idempotent on (fold, op) and has() sees it',
    async run({ oplog, prepareFold }) {
      await prepareFold(FOLD_A);
      const op = sealed(1);
      return { before: await oplog.has(FOLD_A, op.op), first: await oplog.append(local(op)), again: await oplog.append(local(op)), after: await oplog.has(FOLD_A, op.op), otherFold: await oplog.has(FOLD_B, op.op), count: (await oplog.list(FOLD_A)).length };
    },
    expected: { before: false, first: 'inserted', again: 'duplicate', after: true, otherFold: false, count: 1 },
  },
  {
    name: 'a different op reusing (fold, dev, seq) is a seq_conflict and is not stored',
    async run({ oplog, prepareFold }) {
      await prepareFold(FOLD_A);
      await oplog.append(local(sealed(1)));
      const clash = sealed(2, { seq: 1n });
      const sameSeqOtherDevice = sealed(3, { seq: 1n, dev: DEV_2 });
      return { clash: await oplog.append(remote(clash)), otherDevice: await oplog.append(remote(sameSeqOtherDevice)), stored: (await oplog.list(FOLD_A)).map((s) => s.sealed.op) };
    },
    expected: { clash: 'seq_conflict', otherDevice: 'inserted', stored: [id(0x1001), id(0x1003)] },
  },
  {
    name: 'list returns ops in insertion order with every field intact (bigint seq, bytes, HLC)',
    async run({ oplog, prepareFold }) {
      await prepareFold(FOLD_A);
      const ops = [sealed(3), sealed(1), sealed(2, { seq: 2n ** 60n + 5n })];
      for (const o of ops) await oplog.append(remote(o));
      return (await oplog.list(FOLD_A)).map((s) => ({ ...s, sealed: { ...s.sealed } }));
    },
    expected: [sealed(3), sealed(1), sealed(2, { seq: 2n ** 60n + 5n })].map((o) => ({ sealed: o, origin: 'remote', pushed: true })),
  },
  {
    name: 'lastSeq and maxHlc are per Fold (and per device for seq)',
    async run({ oplog, prepareFold }) {
      await prepareFold(FOLD_A);
      await prepareFold(FOLD_B);
      await oplog.append(local(sealed(1)));
      await oplog.append(local(sealed(5, { seq: 5n })));
      await oplog.append(remote(sealed(2, { dev: DEV_2, seq: 9n, hlc: { wallMs: 9_000_000_000_000, ctr: 1 } })));
      await oplog.append(remote(sealed(3, { fold: FOLD_B, op: id(0x3003), seq: 1n, hlc: { wallMs: 5, ctr: 0 } })));
      return {
        dev1: await oplog.lastSeq(FOLD_A, DEV_1), dev2: await oplog.lastSeq(FOLD_A, DEV_2), none: await oplog.lastSeq(FOLD_A, id(0xdd)), foldB: await oplog.lastSeq(FOLD_B, DEV_1),
        maxA: await oplog.maxHlc(FOLD_A), maxB: await oplog.maxHlc(FOLD_B), empty: await oplog.maxHlc(id(0xc1)),
      };
    },
    expected: { dev1: 5n, dev2: 9n, none: 0n, foldB: 1n, maxA: { wallMs: 9_000_000_000_000, ctr: 1 }, maxB: { wallMs: 5, ctr: 0 }, empty: undefined },
  },
  {
    name: 'listPending returns unpushed local ops in seq order; markPushed removes them; remote ops are never pending',
    async run({ oplog, prepareFold }) {
      await prepareFold(FOLD_A);
      for (const n of [3, 1, 2]) await oplog.append(local(sealed(n)));
      await oplog.append(remote(sealed(4, { dev: DEV_2, seq: 1n })));
      const first = (await oplog.listPending(FOLD_A)).map((s) => s.sealed.seq);
      await oplog.markPushed(FOLD_A, [id(0x1001), id(0x1002)]);
      const second = (await oplog.listPending(FOLD_A)).map((s) => s.sealed.seq);
      const flags = (await oplog.list(FOLD_A)).map((s) => [s.sealed.seq, s.origin, s.pushed]);
      return { first, second, flags };
    },
    expected: { first: [1n, 2n, 3n], second: [3n], flags: [[3n, 'local', false], [1n, 'local', true], [2n, 'local', true], [1n, 'remote', true]] },
  },
  {
    name: 'quarantine stores the whole sealed op with its reason, per Fold',
    async run({ oplog, prepareFold }) {
      await prepareFold(FOLD_A);
      await prepareFold(FOLD_B);
      const q1: QuarantinedOp = { sealed: sealed(1), reason: 'bad_signature', atMs: 111 };
      const q2: QuarantinedOp = { sealed: sealed(2, { fold: FOLD_B, op: id(0x4004) }), reason: 'clock_ahead', atMs: 222 };
      await oplog.quarantine(q1);
      await oplog.quarantine(q2);
      await oplog.quarantine({ ...q1, reason: 'unknown_key', atMs: 333 }); // same op again: latest verdict wins
      return { a: await oplog.listQuarantined(FOLD_A), b: (await oplog.listQuarantined(FOLD_B)).map((q) => q.reason), appliedList: (await oplog.list(FOLD_A)).length };
    },
    expected: { a: [{ sealed: sealed(1), reason: 'unknown_key', atMs: 333 }], b: ['clock_ahead'], appliedList: 0 },
  },
  {
    name: 'a record round-trips exactly: every value shape, sets, tombstone and the table-conflict flag',
    async run({ projections, prepareFold }) {
      await prepareFold(FOLD_A);
      await projections.putRecord(FOLD_A, id(0x100), richRecord());
      return { one: plain(await projections.getRecord(FOLD_A, id(0x100))), missing: await projections.getRecord(FOLD_A, id(0x999)), list: [...(await projections.listRecords(FOLD_A))].map(([k, v]) => [k, plain(v)]) };
    },
    expected: { one: plain(richRecord()), missing: undefined, list: [[id(0x100), plain(richRecord())]] },
  },
  {
    name: 'putRecord replaces the previous state of the record, including removed fields and sets',
    async run({ projections, prepareFold }) {
      await prepareFold(FOLD_A);
      await projections.putRecord(FOLD_A, id(0x100), richRecord());
      const smaller: RecordState = { table: 6, tableConflict: false, fields: new Map([[1, entry(11, 'only field')]]), sets: new Map() };
      await projections.putRecord(FOLD_A, id(0x100), smaller);
      return plain(await projections.getRecord(FOLD_A, id(0x100)));
    },
    expected: plain({ table: 6, tableConflict: false, fields: new Map([[1, entry(11, 'only field')]]), sets: new Map() }),
  },
  {
    name: 'Folds are isolated: same record id, clear() and listRecords() never cross',
    async run({ projections, prepareFold }) {
      await prepareFold(FOLD_A);
      await prepareFold(FOLD_B);
      const b: RecordState = { table: 3, tableConflict: false, fields: new Map([[1, entry(21, 'in B')]]), sets: new Map() };
      await projections.putRecord(FOLD_A, id(0x100), richRecord());
      await projections.putRecord(FOLD_B, id(0x100), b);
      await projections.clear(FOLD_A);
      return { a: (await projections.listRecords(FOLD_A)).size, b: plain(await projections.getRecord(FOLD_B, id(0x100))) };
    },
    expected: { a: 0, b: plain({ table: 3, tableConflict: false, fields: new Map([[1, entry(21, 'in B')]]), sets: new Map() }) },
  },
  {
    name: 'transaction: a thrown error undoes op-log appends and projection writes together; success keeps both',
    async run({ oplog, projections, prepareFold }) {
      await prepareFold(FOLD_A);
      const failed = await projections
        .transaction(async () => {
          await oplog.append(local(sealed(1)));
          await projections.putRecord(FOLD_A, id(0x100), richRecord());
          throw new Error('boom');
        })
        .then(() => 'committed', (e: Error) => e.message);
      const afterFailure = { ops: (await oplog.list(FOLD_A)).length, records: (await projections.listRecords(FOLD_A)).size };
      await projections.transaction(async () => {
        await oplog.append(local(sealed(2)));
        await projections.putRecord(FOLD_A, id(0x100), richRecord());
      });
      return { failed, afterFailure, afterSuccess: { ops: (await oplog.list(FOLD_A)).length, records: (await projections.listRecords(FOLD_A)).size } };
    },
    expected: { failed: 'boom', afterFailure: { ops: 0, records: 0 }, afterSuccess: { ops: 1, records: 1 } },
  },
];
