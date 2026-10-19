import { idFromBytes, idToBytes, type FieldEntry, type Id, type RecordState, type SetState } from '@cashfold/core';
import { decode, encode, type CborValue } from '@cashfold/protocol/cbor';
import { fromCbor } from './value-codec';

// One record's whole merge state in one value: how a Fold is read back in one row per record instead of one per field (SC-008). It is written
// in the same transaction as the normalized rows, which stay the source of truth; this is a copy that can always be rebuilt from them.
//   [ 1, table, conflict, [id, ...], [[field, wall, ctr, dev, op, value], ...], [[field, [[member, [tag, ...]], ...], [[member, [tag, ...]], ...]], ...] ]
// `dev` and `op` index into the list of ids: a record is usually written by one change on one device, so it holds two or three of them.

const VERSION = 1n;

export function encodeRecord(state: RecordState): Uint8Array {
  const ids: Uint8Array[] = [];
  const at = new Map<Id, number>();
  const index = (id: Id): bigint => {
    let i = at.get(id);
    if (i === undefined) {
      i = ids.length;
      ids.push(idToBytes(id));
      at.set(id, i);
    }
    return BigInt(i);
  };
  const fields: CborValue[] = [];
  for (const [field, e] of state.fields) fields.push([BigInt(field), BigInt(e.hlc.wallMs), BigInt(e.hlc.ctr), index(e.dev), index(e.opId), e.value as CborValue]);
  const side = (m: ReadonlyMap<Id, ReadonlySet<Id>>): CborValue => [...m].map(([member, tags]) => [idToBytes(member), [...tags].map(idToBytes)]);
  const sets: CborValue[] = [...state.sets].map(([field, s]) => [BigInt(field), side(s.adds), side(s.removed)]);
  return encode([VERSION, BigInt(state.table), state.tableConflict, ids, fields, sets] as CborValue);
}

/** The state encoded by `encodeRecord`, or undefined when the bytes are not in this format (an older or damaged copy: read the rows instead). */
export function decodeRecord(bytes: Uint8Array): RecordState | undefined {
  try {
    const v = decode(bytes) as CborValue[];
    if (!Array.isArray(v) || v[0] !== VERSION) return undefined;
    const [, table, conflict, rawIds, rawFields, rawSets] = v as [bigint, bigint, boolean, Uint8Array[], CborValue[][], CborValue[][]];
    const ids = rawIds.map((b) => idFromBytes(b));
    const fields = new Map<number, FieldEntry>();
    for (const f of rawFields) fields.set(Number(f[0]), { hlc: { wallMs: Number(f[1]), ctr: Number(f[2]) }, dev: ids[Number(f[3])]!, opId: ids[Number(f[4])]!, value: fromCbor(f[5] as CborValue) });
    const side = (raw: CborValue): Map<Id, Set<Id>> => new Map((raw as CborValue[][]).map((m) => [idFromBytes(m[0] as Uint8Array), new Set((m[1] as Uint8Array[]).map((t) => idFromBytes(t)))]));
    const sets = new Map<number, SetState>();
    for (const s of rawSets) sets.set(Number(s[0]), { adds: side(s[1] as CborValue), removed: side(s[2] as CborValue) });
    return { table: Number(table), tableConflict: conflict, fields, sets };
  } catch {
    return undefined;
  }
}
