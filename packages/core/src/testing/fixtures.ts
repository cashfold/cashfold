import type { Id } from '../shared-kernel/id';
import type { FieldEntry, FieldValue, RecordState, SetDelta, SetState } from '../sync/domain/merge';
import type { WireOp } from '../sync/ports/index';

// JSON form of ops and projected state for frozen replay fixtures in vectors/ops/.
// bigint -> {"$bigint": "123"}, bytes -> {"$hex": "ab12"}; maps -> arrays of pairs.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.slice(i * 2, i * 2 + 2), 16));

export function valueToJson(v: FieldValue): Json {
  if (typeof v === 'bigint') return { $bigint: v.toString() };
  if (v instanceof Uint8Array) return { $hex: hex(v) };
  if (Array.isArray(v)) return (v as readonly FieldValue[]).map(valueToJson);
  if (v !== null && typeof v === 'object') return { $map: Object.entries(v).map(([k, x]) => [k, valueToJson(x as FieldValue)]) };
  return v as Json;
}

export function valueFromJson(j: Json): FieldValue {
  if (Array.isArray(j)) return j.map(valueFromJson);
  if (j !== null && typeof j === 'object') {
    if ('$bigint' in j) return BigInt(j['$bigint'] as string);
    if ('$hex' in j) return unhex(j['$hex'] as string);
    if ('$map' in j) return Object.fromEntries((j['$map'] as [string, Json][]).map(([k, x]) => [k, valueFromJson(x)]));
    throw new Error('unknown fixture value');
  }
  return j as FieldValue;
}

export function wireOpFromJson(j: Json): WireOp {
  const o = j as { [k: string]: Json };
  const hlc = o['hlc'] as { wallMs: number; ctr: number };
  return {
    fold: o['fold'] as Id, op: o['op'] as Id, rec: o['rec'] as Id, dev: o['dev'] as Id,
    seq: BigInt(o['seq'] as string), hlc, epoch: o['epoch'] as number, schema: o['schema'] as number, table: o['table'] as number,
    fields: new Map((o['fields'] as [number, Json][]).map(([f, v]) => [f, valueFromJson(v)])),
    sets: new Map((o['sets'] as [number, { add: Id[]; rem: [Id, Id][] }][]).map(([f, d]): [number, SetDelta] => [f, { add: d.add, rem: d.rem }])),
  };
}

export function wireOpToJson(op: WireOp): Json {
  return {
    fold: op.fold, op: op.op, rec: op.rec, dev: op.dev, seq: op.seq.toString(), hlc: { ...op.hlc }, epoch: op.epoch,
    schema: op.schema, table: op.table,
    fields: [...op.fields].map(([f, v]) => [f, valueToJson(v)]),
    sets: [...op.sets].map(([f, d]) => [f, { add: [...d.add], rem: d.rem.map(([m, t]) => [m, t]) }]),
  };
}

const sortedEntries = <V>(m: ReadonlyMap<number, V>): [number, V][] => [...m].sort(([a], [b]) => a - b);

function setStateToJson(s: SetState): Json {
  const byMember = (m: ReadonlyMap<Id, ReadonlySet<Id>>): Json => [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([member, tags]) => [member, [...tags].sort()]);
  return { adds: byMember(s.adds), removed: byMember(s.removed) };
}

function entryToJson(e: FieldEntry): Json {
  return { hlc: { ...e.hlc }, dev: e.dev, opId: e.opId, value: valueToJson(e.value) };
}

/** Canonical, order-independent JSON of a projected record, for golden comparison. */
export function recordToJson(rec: Id, r: RecordState): Json {
  return {
    rec, table: r.table, tableConflict: r.tableConflict,
    fields: sortedEntries(r.fields).map(([f, e]) => [f, entryToJson(e)]),
    sets: sortedEntries(r.sets).map(([f, s]) => [f, setStateToJson(s)]),
  };
}

export function foldToJson(records: ReadonlyMap<Id, RecordState>): Json {
  return [...records].sort(([a], [b]) => (a < b ? -1 : 1)).map(([rec, r]) => recordToJson(rec, r));
}
