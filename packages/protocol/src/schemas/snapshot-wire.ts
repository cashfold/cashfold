import { decode, encode } from '../cbor/cbor';

// The byte format of a snapshot's payload (the merged state of a Fold). Ids travel as canonical UUID text. Everything is
// definite-length deterministic CBOR, so two devices holding the same state produce the same bytes. Decoding validates
// every field and throws SnapshotFormatError for anything else; nothing here trusts its input.

export class SnapshotFormatError extends Error {
  constructor() {
    super('malformed snapshot');
    this.name = 'SnapshotFormatError';
  }
}

export type SnapshotValue = bigint | string | Uint8Array | boolean | null | readonly SnapshotValue[] | { readonly [key: string]: SnapshotValue };

export interface SnapshotField {
  readonly hlc: { readonly wallMs: number; readonly ctr: number };
  readonly dev: string;
  readonly opId: string;
  readonly value: SnapshotValue;
}

export interface SnapshotSet {
  /** member -> tags */
  readonly adds: ReadonlyMap<string, ReadonlySet<string>>;
  readonly removed: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface SnapshotRecord {
  readonly table: number;
  readonly tableConflict: boolean;
  readonly fields: ReadonlyMap<number, SnapshotField>;
  readonly sets: ReadonlyMap<number, SnapshotSet>;
}

export interface SnapshotWire {
  /** For each device, the highest sequence number whose effect the snapshot contains. */
  readonly baseline: ReadonlyMap<string, bigint>;
  readonly records: ReadonlyMap<string, SnapshotRecord>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Cbor = Parameters<typeof encode>[0];

const bad = (): never => {
  throw new SnapshotFormatError();
};
const asId = (v: unknown): string => (typeof v === 'string' && UUID.test(v) ? v : bad());
const asArray = (v: unknown): readonly unknown[] => (Array.isArray(v) ? (v as unknown[]) : bad());
const asInt = (v: unknown): bigint => (typeof v === 'bigint' ? v : bad());
const asSmall = (v: unknown, max: number): number => {
  const n = asInt(v);
  return n >= 0n && n <= BigInt(max) ? Number(n) : bad();
};

function value(v: unknown, depth = 0): SnapshotValue {
  if (depth > 64) return bad();
  if (typeof v === 'bigint' || typeof v === 'string' || typeof v === 'boolean' || v === null || v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return (v as unknown[]).map((x) => value(x, depth + 1));
  if (v instanceof Map) {
    const out: Record<string, SnapshotValue> = Object.create(null) as Record<string, SnapshotValue>;
    for (const [k, x] of v as Map<unknown, unknown>) out[typeof k === 'string' ? k : bad()] = value(x, depth + 1);
    return out;
  }
  return bad();
}

const byKey = <K extends string | number, V>(m: ReadonlyMap<K, V>): [K, V][] => [...m].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const tagList = (m: ReadonlyMap<string, ReadonlySet<string>>): Cbor => byKey(m).map(([member, tags]) => [member, [...tags].sort()]) as Cbor;

export function encodeSnapshot(data: SnapshotWire): Uint8Array {
  const recs = byKey(data.records).map(([rec, r]) => [
    rec, r.table, r.tableConflict,
    byKey(r.fields).map(([f, e]) => [f, e.hlc.wallMs, e.hlc.ctr, e.dev, e.opId, e.value]),
    byKey(r.sets).map(([f, s]) => [f, tagList(s.adds), tagList(s.removed)]),
  ]);
  const base = byKey(data.baseline).map(([dev, seq]) => [dev, seq]);
  return encode({ v: 1n, base, recs } as unknown as Cbor);
}

function tags(v: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const pair of asArray(v)) {
    const [member, list] = asArray(pair);
    out.set(asId(member), new Set(asArray(list).map(asId)));
  }
  return out;
}

export function decodeSnapshot(bytes: Uint8Array): SnapshotWire {
  let root: unknown;
  try {
    root = decode(bytes);
  } catch {
    return bad();
  }
  if (!(root instanceof Map) || root.get('v') !== 1n || root.size !== 3) return bad();
  const baseline = new Map<string, bigint>();
  for (const pair of asArray(root.get('base'))) {
    const [dev, seq] = asArray(pair);
    baseline.set(asId(dev), asInt(seq));
  }
  const records = new Map<string, SnapshotRecord>();
  for (const row of asArray(root.get('recs'))) {
    const [rec, table, conflict, fields, sets] = asArray(row);
    const f = new Map<number, SnapshotField>();
    for (const e of asArray(fields)) {
      const [field, wall, ctr, dev, opId, v] = asArray(e);
      f.set(asSmall(field, 0xffff), { hlc: { wallMs: asSmall(wall, Number.MAX_SAFE_INTEGER), ctr: asSmall(ctr, 0xffff_ffff) }, dev: asId(dev), opId: asId(opId), value: value(v) });
    }
    const s = new Map<number, SnapshotSet>();
    for (const e of asArray(sets)) {
      const [field, adds, removed] = asArray(e);
      s.set(asSmall(field, 0xffff), { adds: tags(adds), removed: tags(removed) });
    }
    records.set(asId(rec), { table: asSmall(table, 14), tableConflict: conflict === true, fields: f, sets: s });
  }
  return { baseline, records };
}
