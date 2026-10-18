import {
  idFromBytes, idToBytes,
  type FieldEntry, type Id, type OpLogStore, type ProjectionStore, type QuarantinedOp, type QuarantineReason, type RecordState, type SealedOp, type SetState, type StoredOp,
} from '@cashfold/core';
import type { Bind, EncryptedDatabase, SqlValue } from './database';
import { decodeValue, encodeValue } from './value-codec';

const OP_PENDING = 0n;
const OP_ACKED = 1n;
const OP_REMOTE = 2n;

const bytesOf = (id: Id): Uint8Array => idToBytes(id);
const idOf = (v: SqlValue | undefined): Id => idFromBytes(v as Uint8Array);
const num = (v: SqlValue | undefined): number => Number(v as bigint);

const OP_COLUMNS = 'op_id, rec_id, dev_id, dev_seq, hlc_wall, hlc_ctr, epoch, schema_ver, blob, sig';

function sealedFrom(fold: Id, r: SqlValue[], at = 0): SealedOp {
  return {
    fold, op: idOf(r[at]), rec: idOf(r[at + 1]), dev: idOf(r[at + 2]), seq: r[at + 3] as bigint,
    hlc: { wallMs: num(r[at + 4]), ctr: num(r[at + 5]) }, epoch: num(r[at + 6]), schema: num(r[at + 7]),
    blob: r[at + 8] as Uint8Array, sig: r[at + 9] as Uint8Array,
  };
}

/** Domain-table projection for one table code. Runs inside the same transaction as the merge-state write. */
export interface Projector {
  apply(db: EncryptedDatabase, fold: Id, rec: Id, state: RecordState): void;
}

export interface SqliteStoreOptions {
  /** Read-model writers keyed by table code (ledger, budgeting, ...). Merge state itself never depends on them. */
  readonly projectors?: ReadonlyMap<number, Projector>;
  /** Domain tables to empty when a Fold's projections are cleared for a rebuild. */
  readonly domainTables?: readonly string[];
}

export function createSqliteOpLog(db: EncryptedDatabase): OpLogStore {
  const first = (sql: string, bind: Bind[]) => db.rows(sql, bind)[0];
  return {
    async has(fold, op) {
      return first('SELECT 1 FROM op_log WHERE fold_id = ? AND op_id = ?', [bytesOf(fold), bytesOf(op)]) !== undefined;
    },

    async append({ sealed: s, origin, pushed }) {
      const fold = bytesOf(s.fold);
      if (first('SELECT 1 FROM op_log WHERE fold_id = ? AND op_id = ?', [fold, bytesOf(s.op)]) !== undefined) return 'duplicate';
      if (first('SELECT 1 FROM op_log WHERE fold_id = ? AND dev_id = ? AND dev_seq = ?', [fold, bytesOf(s.dev), s.seq]) !== undefined) return 'seq_conflict';
      const state = origin === 'remote' ? OP_REMOTE : pushed ? OP_ACKED : OP_PENDING;
      db.run(`INSERT INTO op_log(fold_id, ${OP_COLUMNS}, state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
        fold, bytesOf(s.op), bytesOf(s.rec), bytesOf(s.dev), s.seq, BigInt(s.hlc.wallMs), BigInt(s.hlc.ctr), BigInt(s.epoch), BigInt(s.schema), s.blob, s.sig, state,
      ]);
      return 'inserted';
    },

    async lastSeq(fold, dev) {
      const v = db.value('SELECT MAX(dev_seq) FROM op_log WHERE fold_id = ? AND dev_id = ?', [bytesOf(fold), bytesOf(dev)]);
      return (v as bigint | null) ?? 0n;
    },

    async maxHlc(fold) {
      const r = first('SELECT hlc_wall, hlc_ctr FROM op_log WHERE fold_id = ? ORDER BY hlc_wall DESC, hlc_ctr DESC LIMIT 1', [bytesOf(fold)]);
      return r === undefined ? undefined : { wallMs: num(r[0]), ctr: num(r[1]) };
    },

    async list(fold) {
      return db.rows(`SELECT ${OP_COLUMNS}, state FROM op_log WHERE fold_id = ? ORDER BY rowid`, [bytesOf(fold)]).map((r): StoredOp => {
        const state = r[10] as bigint;
        return { sealed: sealedFrom(fold, r), origin: state === OP_REMOTE ? 'remote' : 'local', pushed: state !== OP_PENDING };
      });
    },

    async listPending(fold) {
      return db.rows(`SELECT ${OP_COLUMNS} FROM op_log WHERE fold_id = ? AND state = 0 ORDER BY dev_seq`, [bytesOf(fold)]).map((r): StoredOp => ({ sealed: sealedFrom(fold, r), origin: 'local', pushed: false }));
    },

    async markPushed(fold, ops) {
      for (const op of ops) db.run('UPDATE op_log SET state = 1 WHERE fold_id = ? AND op_id = ? AND state = 0', [bytesOf(fold), bytesOf(op)]);
    },

    async quarantine({ sealed: s, reason, atMs }) {
      db.run(
        'INSERT OR REPLACE INTO sync_quarantine(fold_id, op_id, rec_id, dev_id, dev_seq, hlc_wall, hlc_ctr, epoch, schema_ver, blob, sig, reason, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [bytesOf(s.fold), bytesOf(s.op), bytesOf(s.rec), bytesOf(s.dev), s.seq, BigInt(s.hlc.wallMs), BigInt(s.hlc.ctr), BigInt(s.epoch), BigInt(s.schema), s.blob, s.sig, reason, BigInt(atMs)],
      );
    },

    async listQuarantined(fold) {
      return db.rows(`SELECT ${OP_COLUMNS}, reason, seen_at FROM sync_quarantine WHERE fold_id = ? ORDER BY rowid`, [bytesOf(fold)]).map(
        (r): QuarantinedOp => ({ sealed: sealedFrom(fold, r), reason: r[10] as QuarantineReason, atMs: num(r[11]) }),
      );
    },
  };
}

export function createSqliteProjections(db: EncryptedDatabase, options: SqliteStoreOptions = {}): ProjectionStore {
  const projectors = options.projectors ?? new Map<number, Projector>();
  const domainTables = options.domainTables ?? [];

  const loadSets = (fold: Uint8Array, rec: Uint8Array | undefined, adds: Map<Id, Map<number, Map<Id, Set<Id>>>>, removed: Map<Id, Map<number, Map<Id, Set<Id>>>>) => {
    for (const [table, target] of [['set_add', adds], ['set_removed', removed]] as const) {
      const sql = `SELECT rec_id, field_id, member, tag FROM ${table} WHERE fold_id = ?${rec ? ' AND rec_id = ?' : ''}`;
      for (const r of db.rows(sql, rec ? [fold, rec] : [fold])) {
        const byField = target.get(idOf(r[0])) ?? new Map<number, Map<Id, Set<Id>>>();
        const byMember = byField.get(num(r[1])) ?? new Map<Id, Set<Id>>();
        const tags = byMember.get(idOf(r[2])) ?? new Set<Id>();
        tags.add(idOf(r[3]));
        byMember.set(idOf(r[2]), tags);
        byField.set(num(r[1]), byMember);
        target.set(idOf(r[0]), byField);
      }
    }
  };

  function assemble(
    rec: Id,
    meta: SqlValue[],
    fieldRows: SqlValue[][],
    adds: Map<Id, Map<number, Map<Id, Set<Id>>>>,
    removed: Map<Id, Map<number, Map<Id, Set<Id>>>>,
  ): RecordState {
    const fields = new Map<number, FieldEntry>();
    for (const r of fieldRows) {
      fields.set(num(r[0]), { hlc: { wallMs: num(r[1]), ctr: num(r[2]) }, dev: idOf(r[3]), opId: idOf(r[4]), value: decodeValue(r[5] as Uint8Array) });
    }
    const sets = new Map<number, SetState>();
    const addsFor = adds.get(rec) ?? new Map<number, Map<Id, Set<Id>>>();
    const removedFor = removed.get(rec) ?? new Map<number, Map<Id, Set<Id>>>();
    for (const field of new Set([...addsFor.keys(), ...removedFor.keys()])) {
      sets.set(field, { adds: addsFor.get(field) ?? new Map(), removed: removedFor.get(field) ?? new Map() });
    }
    return { table: num(meta[0]), tableConflict: meta[1] === 1n, fields, sets };
  }

  return {
    transaction: (fn) => db.transaction(fn),

    async getRecord(fold, rec) {
      const [f, r] = [bytesOf(fold), bytesOf(rec)];
      const meta = db.rows('SELECT table_code, table_conflict FROM record_meta WHERE fold_id = ? AND rec_id = ?', [f, r])[0];
      if (meta === undefined) return undefined;
      const adds = new Map<Id, Map<number, Map<Id, Set<Id>>>>();
      const removed = new Map<Id, Map<number, Map<Id, Set<Id>>>>();
      loadSets(f, r, adds, removed);
      const fieldRows = db.rows('SELECT field_id, hlc_wall, hlc_ctr, dev_id, op_id, value FROM field_clock WHERE fold_id = ? AND rec_id = ?', [f, r]);
      return assemble(rec, meta, fieldRows, adds, removed);
    },

    async putRecord(fold, rec, state) {
      const [f, r] = [bytesOf(fold), bytesOf(rec)];
      db.run(
        'INSERT INTO record_meta(fold_id, rec_id, table_code, table_conflict) VALUES (?,?,?,?) ON CONFLICT(fold_id, rec_id) DO UPDATE SET table_code = excluded.table_code, table_conflict = excluded.table_conflict',
        [f, r, BigInt(state.table), state.tableConflict ? 1n : 0n],
      );
      db.run('DELETE FROM field_clock WHERE fold_id = ? AND rec_id = ?', [f, r]);
      for (const [field, e] of state.fields) {
        db.run('INSERT INTO field_clock(fold_id, rec_id, field_id, hlc_wall, hlc_ctr, dev_id, op_id, value) VALUES (?,?,?,?,?,?,?,?)', [
          f, r, BigInt(field), BigInt(e.hlc.wallMs), BigInt(e.hlc.ctr), bytesOf(e.dev), bytesOf(e.opId), encodeValue(e.value),
        ]);
      }
      for (const table of ['set_add', 'set_removed']) db.run(`DELETE FROM ${table} WHERE fold_id = ? AND rec_id = ?`, [f, r]);
      for (const [field, set] of state.sets) {
        for (const [table, side] of [['set_add', set.adds], ['set_removed', set.removed]] as const) {
          for (const [member, tags] of side) {
            for (const tag of tags) db.run(`INSERT INTO ${table}(fold_id, rec_id, field_id, member, tag) VALUES (?,?,?,?,?)`, [f, r, BigInt(field), bytesOf(member), bytesOf(tag)]);
          }
        }
      }
      projectors.get(state.table)?.apply(db, fold, rec, state);
    },

    async listRecords(fold) {
      const f = bytesOf(fold);
      const adds = new Map<Id, Map<number, Map<Id, Set<Id>>>>();
      const removed = new Map<Id, Map<number, Map<Id, Set<Id>>>>();
      loadSets(f, undefined, adds, removed);
      const fieldsByRec = new Map<Id, SqlValue[][]>();
      for (const r of db.rows('SELECT rec_id, field_id, hlc_wall, hlc_ctr, dev_id, op_id, value FROM field_clock WHERE fold_id = ?', [f])) {
        const rec = idOf(r[0]);
        fieldsByRec.set(rec, [...(fieldsByRec.get(rec) ?? []), r.slice(1)]);
      }
      const out = new Map<Id, RecordState>();
      for (const meta of db.rows('SELECT rec_id, table_code, table_conflict FROM record_meta WHERE fold_id = ? ORDER BY rec_id', [f])) {
        const rec = idOf(meta[0]);
        out.set(rec, assemble(rec, meta.slice(1), fieldsByRec.get(rec) ?? [], adds, removed));
      }
      return out;
    },

    async clear(fold) {
      const f = bytesOf(fold);
      for (const table of ['set_removed', 'set_add', 'field_clock', 'record_meta', ...domainTables]) db.run(`DELETE FROM ${table} WHERE fold_id = ?`, [f]);
    },
  };
}
