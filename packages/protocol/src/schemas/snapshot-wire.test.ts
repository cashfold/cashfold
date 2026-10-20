import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeSnapshot, SnapshotFormatError, type SnapshotRecord, type SnapshotValue } from './snapshot-wire';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const idArb = fc.integer({ min: 1, max: 40 }).map(uuid);
const valueArb: fc.Arbitrary<SnapshotValue> = fc.oneof(fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }), fc.string(), fc.boolean(), fc.constant(null), fc.uint8Array({ maxLength: 8 }));
const tagsArb = fc.array(fc.tuple(idArb, fc.array(idArb, { minLength: 1, maxLength: 3 }).map((t) => new Set(t))), { maxLength: 3 }).map((a) => new Map(a));
const recordArb: fc.Arbitrary<SnapshotRecord> = fc.record({
  table: fc.integer({ min: 1, max: 14 }),
  tableConflict: fc.boolean(),
  fields: fc.array(fc.tuple(fc.integer({ min: 0, max: 0xffff }), fc.record({ hlc: fc.record({ wallMs: fc.integer({ min: 0, max: 2 ** 50 }), ctr: fc.integer({ min: 0, max: 100 }) }), dev: idArb, opId: idArb, value: valueArb })), { maxLength: 5 }).map((a) => new Map(a)),
  sets: fc.array(fc.tuple(fc.integer({ min: 0, max: 9 }), fc.record({ adds: tagsArb, removed: tagsArb })), { maxLength: 3 }).map((a) => new Map(a)),
});

describe('snapshot payload format', () => {
  it('round-trips any state and is deterministic', () => {
    fc.assert(fc.property(fc.array(fc.tuple(idArb, recordArb), { maxLength: 6 }), fc.array(fc.tuple(idArb, fc.bigInt({ min: 0n, max: 10_000n })), { maxLength: 4 }), (recs, base) => {
      const data = { records: new Map(recs), baseline: new Map(base) };
      const bytes = encodeSnapshot(data);
      const back = decodeSnapshot(bytes);
      expect(encodeSnapshot(back)).toEqual(bytes);
      expect(back.records.size).toBe(data.records.size);
      expect(back.baseline).toEqual(data.baseline);
      for (const [rec, r] of data.records) expect(back.records.get(rec)?.fields.size).toBe(r.fields.size);
    }), { numRuns: 60 });
  });

  it('does not depend on insertion order', () => {
    const [a, b] = [new Map([[uuid(1), 5n], [uuid(2), 9n]]), new Map([[uuid(2), 9n], [uuid(1), 5n]])];
    expect(encodeSnapshot({ records: new Map(), baseline: a })).toEqual(encodeSnapshot({ records: new Map(), baseline: b }));
  });

  it('keeps 64-bit integers exact', () => {
    const rec: SnapshotRecord = { table: 6, tableConflict: false, fields: new Map([[1, { hlc: { wallMs: 1, ctr: 0 }, dev: uuid(1), opId: uuid(2), value: 2n ** 62n + 1n }]]), sets: new Map() };
    const back = decodeSnapshot(encodeSnapshot({ records: new Map([[uuid(3), rec]]), baseline: new Map() }));
    expect(back.records.get(uuid(3))!.fields.get(1)!.value).toBe(2n ** 62n + 1n);
  });

  it('rejects malformed input with one error type', () => {
    const good = encodeSnapshot({ records: new Map(), baseline: new Map() });
    for (const bytes of [new Uint8Array(), Uint8Array.from([0xff]), good.slice(0, good.length - 1), Uint8Array.from([...good, 0])]) expect(() => decodeSnapshot(bytes)).toThrow(SnapshotFormatError);
  });

  it('rejects values outside the format: bad ids, unknown tables, out-of-range fields', () => {
    const rec = (over: Partial<SnapshotRecord>): SnapshotRecord => ({ table: 6, tableConflict: false, fields: new Map(), sets: new Map(), ...over });
    const make = (id: string, r: SnapshotRecord) => encodeSnapshot({ records: new Map([[id, r]]), baseline: new Map() });
    expect(() => decodeSnapshot(make('NOT-A-UUID', rec({})))).toThrow(SnapshotFormatError);
    expect(() => decodeSnapshot(make(uuid(1), rec({ table: 15 })))).toThrow(SnapshotFormatError);
    expect(() => decodeSnapshot(make(uuid(1), rec({ fields: new Map([[0x1_0000, { hlc: { wallMs: 1, ctr: 0 }, dev: uuid(1), opId: uuid(2), value: null }]]) })))).toThrow(SnapshotFormatError);
  });
});
