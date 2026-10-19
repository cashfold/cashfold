import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import { winner, type FieldEntry, type FieldValue } from './field-clock';
import type { Hlc } from './hlc';

export type { FieldEntry, FieldValue } from './field-clock';

/**
 * Convergent merge of operations (ARCH 9.4). Every operation is lifted to a one-op record state and
 * states are joined: per field the greater `(stamp, op id)`, per set the union of adds and of removed
 * tags. A join of maxima and unions is commutative, associative and idempotent, so the result depends
 * only on the *set* of operations received.
 */

/** Reserved register holding the tombstone flag (`deleted`). */
export const DELETED_FIELD = 0xffff;
const MAX_TABLE = 14;

/** An add-wins observed-remove set delta. The tag of every added member is the carrying op's id. */
export interface SetDelta {
  readonly add: readonly Id[];
  /** `[member, add-op-id]` pairs: only the adds the remover observed are removed. */
  readonly rem: readonly (readonly [Id, Id])[];
  /**
   * `[member, tag]` pairs added under an explicit tag instead of this op's id. Only a baseline republished for a new member
   * uses them, so the tags the other members already hold stay the same and a later remove still names the right adds.
   */
  readonly tagged?: readonly (readonly [Id, Id])[];
}

export interface Op {
  readonly id: Id;
  readonly rec: Id;
  readonly dev: Id;
  readonly hlc: Hlc;
  readonly table: number;
  readonly fields: ReadonlyMap<number, FieldValue>;
  readonly sets: ReadonlyMap<number, SetDelta>;
}

export interface SetState {
  /** member -> tags (ids of the ops that added it). */
  readonly adds: ReadonlyMap<Id, ReadonlySet<Id>>;
  /** member -> tags whose add a remover observed. Keyed per member: one op may add several members under one tag. */
  readonly removed: ReadonlyMap<Id, ReadonlySet<Id>>;
}

export interface RecordState {
  readonly table: number;
  /** True when ops for different tables were seen for this record id; it is malformed and flagged for repair. */
  readonly tableConflict: boolean;
  readonly fields: ReadonlyMap<number, FieldEntry>;
  readonly sets: ReadonlyMap<number, SetState>;
}

export type FoldState = ReadonlyMap<Id, RecordState>;

export type MergeError = DomainError<'invalid_table' | 'invalid_field' | 'group_incomplete'>;

/** Fields that must change together, per table. An op writes a whole group or none of it. */
export type GroupRegistry = ReadonlyMap<number, readonly (readonly number[])[]>;

export const emptyFold = (): FoldState => new Map();

export function validateOp(op: Op, groups: GroupRegistry): Result<Op, MergeError> {
  if (!Number.isInteger(op.table) || op.table < 1 || op.table > MAX_TABLE) return err('invalid_table', 'Unknown table code');
  for (const id of [...op.fields.keys(), ...op.sets.keys()]) {
    if (!Number.isInteger(id) || id < 0 || id > 0xffff) return err('invalid_field', 'Field id out of range');
  }
  for (const group of groups.get(op.table) ?? []) {
    const written = group.filter((f) => op.fields.has(f)).length;
    if (written !== 0 && written !== group.length) {
      return err('group_incomplete', 'An operation must write every field of a field group or none');
    }
  }
  return ok(op);
}

export function recordFromOp(op: Op): RecordState {
  const fields = new Map<number, FieldEntry>();
  for (const [field, value] of op.fields) fields.set(field, { hlc: op.hlc, dev: op.dev, opId: op.id, value });
  const sets = new Map<number, SetState>();
  for (const [field, delta] of op.sets) {
    const adds = new Map<Id, Set<Id>>(delta.add.map((member) => [member, new Set([op.id])]));
    for (const [member, tag] of delta.tagged ?? []) adds.set(member, (adds.get(member) ?? new Set<Id>()).add(tag));
    const removed = new Map<Id, Set<Id>>();
    for (const [member, tag] of delta.rem) removed.set(member, (removed.get(member) ?? new Set<Id>()).add(tag));
    sets.set(field, { adds, removed });
  }
  return { table: op.table, tableConflict: false, fields, sets };
}

function unionByMember(sources: readonly ReadonlyMap<Id, ReadonlySet<Id>>[]): Map<Id, Set<Id>> {
  const out = new Map<Id, Set<Id>>();
  for (const source of sources) {
    for (const [member, tags] of source) {
      const into = out.get(member) ?? new Set<Id>();
      for (const tag of tags) into.add(tag);
      out.set(member, into);
    }
  }
  return out;
}

function mergeSets(a: SetState, b: SetState): SetState {
  return { adds: unionByMember([a.adds, b.adds]), removed: unionByMember([a.removed, b.removed]) };
}

export function mergeRecords(a: RecordState, b: RecordState): RecordState {
  const fields = new Map(a.fields);
  for (const [field, entry] of b.fields) {
    const current = fields.get(field);
    fields.set(field, current === undefined ? entry : winner(current, entry));
  }
  const sets = new Map(a.sets);
  for (const [field, state] of b.sets) {
    const current = sets.get(field);
    sets.set(field, current === undefined ? state : mergeSets(current, state));
  }
  return {
    table: Math.min(a.table, b.table),
    tableConflict: a.tableConflict || b.tableConflict || a.table !== b.table,
    fields,
    sets,
  };
}

/** Applies an op to a mutable fold map in place (record states themselves are never mutated). */
export function applyOpInto(fold: Map<Id, RecordState>, op: Op): void {
  const incoming = recordFromOp(op);
  const current = fold.get(op.rec);
  fold.set(op.rec, current === undefined ? incoming : mergeRecords(current, incoming));
}

export function applyOp(fold: FoldState, op: Op): FoldState {
  const next = new Map(fold);
  applyOpInto(next, op);
  return next;
}

export function mergeFolds(a: FoldState, b: FoldState): FoldState {
  const out = new Map(a);
  for (const [rec, state] of b) {
    const current = out.get(rec);
    out.set(rec, current === undefined ? state : mergeRecords(current, state));
  }
  return out;
}

/** A record is visible unless its tombstone register currently says deleted. */
export function isVisible(record: RecordState): boolean {
  return record.fields.get(DELETED_FIELD)?.value !== true;
}

/** Members with at least one add tag that no remove has observed. */
export function visibleMembers(record: RecordState, field: number): ReadonlySet<Id> {
  const set = record.sets.get(field);
  const out = new Set<Id>();
  if (set === undefined) return out;
  for (const [member, tags] of set.adds) {
    const removed = set.removed.get(member);
    for (const tag of tags) {
      if (removed?.has(tag) !== true) {
        out.add(member);
        break;
      }
    }
  }
  return out;
}
