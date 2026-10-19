import type { Id, RecordState } from '@cashfold/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeRecord, encodeRecord } from './record-codec';

const id = (n: number, kind = 1): Id => `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}` as Id;
const same = (a: RecordState, b: RecordState): void => {
  expect(b.table).toBe(a.table);
  expect(b.tableConflict).toBe(a.tableConflict);
  expect([...b.fields]).toEqual([...a.fields]);
  expect([...b.sets].map(([f, s]) => [f, [...s.adds].map(([m, t]) => [m, [...t]]), [...s.removed].map(([m, t]) => [m, [...t]])])).toEqual(
    [...a.sets].map(([f, s]) => [f, [...s.adds].map(([m, t]) => [m, [...t]]), [...s.removed].map(([m, t]) => [m, [...t]])]),
  );
};

describe('a record kept in one value', () => {
  const state: RecordState = {
    table: 6, tableConflict: false,
    fields: new Map([
      [1, { hlc: { wallMs: 1_800_000_000_123, ctr: 2 }, dev: id(1, 0xd), opId: id(1, 0xa), value: id(9, 3) }],
      [3, { hlc: { wallMs: 1_800_000_000_124, ctr: 0 }, dev: id(1, 0xd), opId: id(2, 0xa), value: -123_456_789_012_345_678n }],
      [14, { hlc: { wallMs: 1_800_000_000_125, ctr: 7 }, dev: id(2, 0xd), opId: id(2, 0xa), value: 'a note — with “quotes” and émojis 🧾' }],
      [18, { hlc: { wallMs: 1_800_000_000_126, ctr: 0 }, dev: id(1, 0xd), opId: id(1, 0xa), value: null }],
      [19, { hlc: { wallMs: 1_800_000_000_126, ctr: 1 }, dev: id(1, 0xd), opId: id(1, 0xa), value: true }],
      [30, { hlc: { wallMs: 1_800_000_000_127, ctr: 1 }, dev: id(1, 0xd), opId: id(3, 0xa), value: new Uint8Array([1, 2, 3, 255]) }],
      [31, { hlc: { wallMs: 1_800_000_000_127, ctr: 1 }, dev: id(1, 0xd), opId: id(3, 0xa), value: { a: 1n, b: ['x', null, 2n] } }],
    ]),
    sets: new Map([[13, { adds: new Map([[id(5, 5), new Set([id(1, 0xa), id(2, 0xa)])], [id(6, 5), new Set([id(3, 0xa)])]]), removed: new Map([[id(5, 5), new Set([id(1, 0xa)])]]) }]]),
  };

  it('comes back exactly, with every kind of value, and the ids shared by its fields stored once', () => {
    const bytes = encodeRecord(state);
    same(state, decodeRecord(bytes)!);
    expect(bytes.length).toBeLessThan(700);
  });

  it('keeps a record with nothing in it, and one in conflict', () => {
    const empty: RecordState = { table: 13, tableConflict: true, fields: new Map(), sets: new Map() };
    same(empty, decodeRecord(encodeRecord(empty))!);
  });

  it('is refused, not guessed at, when the bytes are anything else', () => {
    for (const bad of [new Uint8Array(0), new Uint8Array([0xff]), new Uint8Array([0x80]), new Uint8Array([0x81, 0x02]), encodeRecord(state).slice(0, 40)]) expect(decodeRecord(bad)).toBeUndefined();
    fc.assert(fc.property(fc.uint8Array({ maxLength: 120 }), (b) => void decodeRecord(b)), { numRuns: 500 }); // never throws
  });

  it('property: any mix of fields and set members survives', () => {
    const entry = fc.record({ wall: fc.integer({ min: 0, max: 2 ** 50 }), ctr: fc.nat(1000), dev: fc.nat(3), op: fc.nat(5), value: fc.oneof(fc.bigInt({ min: -(2n ** 62n), max: 2n ** 62n }), fc.string(), fc.boolean(), fc.constant(null)) });
    fc.assert(fc.property(fc.array(fc.tuple(fc.nat(60), entry), { maxLength: 20 }), fc.array(fc.tuple(fc.nat(5), fc.nat(4), fc.nat(4)), { maxLength: 10 }), (fs, ss) => {
      const fields = new Map(fs.map(([f, e]) => [f, { hlc: { wallMs: e.wall, ctr: e.ctr }, dev: id(e.dev, 0xd), opId: id(e.op, 0xa), value: e.value }]));
      const sets = new Map<number, { adds: Map<Id, Set<Id>>; removed: Map<Id, Set<Id>> }>();
      for (const [f, m, t] of ss) {
        const s = sets.get(f) ?? { adds: new Map(), removed: new Map() };
        s.adds.set(id(m, 5), (s.adds.get(id(m, 5)) ?? new Set()).add(id(t, 0xa)));
        sets.set(f, s);
      }
      const record: RecordState = { table: 6, tableConflict: false, fields, sets };
      same(record, decodeRecord(encodeRecord(record))!);
    }), { numRuns: 300 });
  });
});
