import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id.js';
import {
  DELETED_FIELD, applyOp, emptyFold, isVisible, mergeFolds, mergeRecords, recordFromOp, validateOp, visibleMembers,
  type FieldValue, type FoldState, type GroupRegistry, type Op, type SetDelta,
} from './merge.js';

const id = (n: number): Id => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}` as Id;
const DEV_A = id(0xa);
const DEV_B = id(0xb);
const REC = id(1);
const none: ReadonlyMap<number, SetDelta> = new Map();

let counter = 100;
const op = (o: Partial<Op> & { fields?: ReadonlyMap<number, FieldValue> }): Op => ({
  id: id(++counter), rec: REC, dev: DEV_A, hlc: { wallMs: 1, ctr: 0 }, table: 6, fields: new Map(), sets: none, ...o,
});
const fields = (...entries: Array<[number, FieldValue]>) => new Map<number, FieldValue>(entries);
const fold = (...ops: Op[]): FoldState => ops.reduce(applyOp, emptyFold());
const value = (s: FoldState, field: number): FieldValue | undefined => s.get(REC)?.fields.get(field)?.value;

describe('LWW per field', () => {
  it('the later stamp wins regardless of arrival order', () => {
    const early = op({ hlc: { wallMs: 1, ctr: 0 }, fields: fields([1, 'old']) });
    const late = op({ hlc: { wallMs: 2, ctr: 0 }, fields: fields([1, 'new']) });
    expect(value(fold(early, late), 1)).toBe('new');
    expect(value(fold(late, early), 1)).toBe('new');
  });

  it('compares the counter when wall times tie', () => {
    const a = op({ hlc: { wallMs: 5, ctr: 1 }, fields: fields([1, 'a']) });
    const b = op({ hlc: { wallMs: 5, ctr: 2 }, fields: fields([1, 'b']) });
    expect(value(fold(a, b), 1)).toBe('b');
    expect(value(fold(b, a), 1)).toBe('b');
  });

  it('breaks full clock ties by device id', () => {
    const a = op({ dev: DEV_A, fields: fields([1, 'from-a']) });
    const b = op({ dev: DEV_B, fields: fields([1, 'from-b']) });
    expect(value(fold(a, b), 1)).toBe('from-b');
    expect(value(fold(b, a), 1)).toBe('from-b');
  });

  it('keeps disjoint fields from concurrent ops', () => {
    const a = op({ dev: DEV_A, fields: fields([1, 'name']) });
    const b = op({ dev: DEV_B, fields: fields([2, 'note']) });
    const s = fold(a, b);
    expect([value(s, 1), value(s, 2)]).toEqual(['name', 'note']);
  });

  it('a stale op does not overwrite newer data (it is still stored for other fields)', () => {
    const newer = op({ hlc: { wallMs: 9, ctr: 0 }, fields: fields([1, 'new']) });
    const stale = op({ hlc: { wallMs: 2, ctr: 0 }, fields: fields([1, 'stale'], [2, 'only-here']) });
    const s = fold(newer, stale);
    expect([value(s, 1), value(s, 2)]).toEqual(['new', 'only-here']);
  });

  it('is idempotent', () => {
    const o = op({ fields: fields([1, 'x']) });
    expect(fold(o, o, o)).toEqual(fold(o));
  });

  it('keeps bigint amounts exact', () => {
    const big = 2n ** 62n + 1n;
    expect(value(fold(op({ fields: fields([5, big]) })), 5)).toBe(big);
  });
});

describe('add-wins OR-Set', () => {
  const TAG_FIELD = 10;
  const m1 = id(0x51);
  const m2 = id(0x52);
  const setOp = (delta: Partial<SetDelta>, o: Partial<Op> = {}) =>
    op({ sets: new Map([[TAG_FIELD, { add: [], rem: [], ...delta }]]), ...o });
  const members = (s: FoldState) => [...visibleMembers(s.get(REC)!, TAG_FIELD)].sort();

  it('adds members', () => {
    expect(members(fold(setOp({ add: [m1, m2] })))).toEqual([m1, m2].sort());
  });

  it('removing an observed add removes the member', () => {
    const add = setOp({ add: [m1] });
    const remove = setOp({ rem: [[m1, add.id]] });
    expect(members(fold(add, remove))).toEqual([]);
    expect(members(fold(remove, add))).toEqual([]); // remove delivered first
  });

  it('a concurrent add survives a remove that did not observe it (add wins)', () => {
    const first = setOp({ add: [m1] });
    const concurrentAdd = setOp({ add: [m1] }, { dev: DEV_B });
    const remove = setOp({ rem: [[m1, first.id]] });
    expect(members(fold(first, concurrentAdd, remove))).toEqual([m1]);
    expect(members(fold(remove, concurrentAdd, first))).toEqual([m1]);
  });

  it('re-adding after a removal brings the member back with a fresh tag', () => {
    const add = setOp({ add: [m1] });
    const remove = setOp({ rem: [[m1, add.id]] });
    const readd = setOp({ add: [m1] });
    expect(members(fold(add, remove, readd))).toEqual([m1]);
    expect(members(fold(readd, remove, add))).toEqual([m1]);
  });

  it('removing one member leaves the others', () => {
    const add = setOp({ add: [m1, m2] });
    const remove = setOp({ rem: [[m1, add.id]] });
    expect(members(fold(add, remove))).toEqual([m2]);
  });
});

describe('tombstone (deleted register)', () => {
  it('is a LWW register: delete hides, a later undelete restores', () => {
    const create = op({ hlc: { wallMs: 1, ctr: 0 }, fields: fields([1, 'x']) });
    const del = op({ hlc: { wallMs: 2, ctr: 0 }, fields: fields([DELETED_FIELD, true]) });
    const undelete = op({ hlc: { wallMs: 3, ctr: 0 }, fields: fields([DELETED_FIELD, false]) });
    expect(isVisible(fold(create).get(REC)!)).toBe(true);
    expect(isVisible(fold(create, del).get(REC)!)).toBe(false);
    expect(isVisible(fold(undelete, del, create).get(REC)!)).toBe(true);
  });

  it('field writes after a delete are stored but the record stays invisible', () => {
    const del = op({ hlc: { wallMs: 2, ctr: 0 }, fields: fields([DELETED_FIELD, true]) });
    const later = op({ hlc: { wallMs: 5, ctr: 0 }, fields: fields([1, 'edited-after-delete']) });
    const s = fold(del, later);
    expect(isVisible(s.get(REC)!)).toBe(false);
    expect(value(s, 1)).toBe('edited-after-delete');
  });

  it('a restore on one device wins over an older delete delivered late', () => {
    const del = op({ hlc: { wallMs: 2, ctr: 0 }, fields: fields([DELETED_FIELD, true]), dev: DEV_A });
    const restore = op({ hlc: { wallMs: 3, ctr: 0 }, fields: fields([DELETED_FIELD, false]), dev: DEV_B });
    expect(isVisible(fold(restore, del).get(REC)!)).toBe(true);
  });
});

describe('field groups are atomic', () => {
  const groups: GroupRegistry = new Map([[7, [[1, 2, 3]]]]);
  const transfer = (o: Partial<Op>) => op({ table: 7, ...o });

  it('accepts an op that writes a whole group or none of it', () => {
    expect(validateOp(transfer({ fields: fields([1, 'x'], [2, 'y'], [3, 'z']) }), groups).ok).toBe(true);
    expect(validateOp(transfer({ fields: fields([9, 'unrelated']) }), groups).ok).toBe(true);
  });

  it('rejects an op that writes part of a group', () => {
    const r = validateOp(transfer({ fields: fields([1, 'x'], [2, 'y']) }), groups);
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ code: 'group_incomplete' }) });
  });

  it('concurrent group writes resolve to one whole version, never a mix', () => {
    const a = transfer({ dev: DEV_A, hlc: { wallMs: 5, ctr: 0 }, fields: fields([1, 'a1'], [2, 'a2'], [3, 'a3']) });
    const b = transfer({ dev: DEV_B, hlc: { wallMs: 5, ctr: 1 }, fields: fields([1, 'b1'], [2, 'b2'], [3, 'b3']) });
    for (const s of [fold(a, b), fold(b, a)]) expect([value(s, 1), value(s, 2), value(s, 3)]).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('record identity', () => {
  it('rejects ops with an invalid table code', () => {
    for (const table of [0, 15, -1, 1.5]) expect(validateOp(op({ table }), new Map()).ok).toBe(false);
  });

  it('flags a record that receives ops for two different tables, deterministically', () => {
    const a = op({ table: 6, fields: fields([1, 'x']) });
    const b = op({ table: 3, fields: fields([1, 'y']) });
    const s1 = fold(a, b).get(REC)!;
    const s2 = fold(b, a).get(REC)!;
    expect(s1.table).toBe(3);
    expect(s1.tableConflict).toBe(true);
    expect(s2).toEqual(s1);
  });

  it('keeps records separate', () => {
    const other = id(2);
    const s = fold(op({ fields: fields([1, 'a']) }), op({ rec: other, fields: fields([1, 'b']) }));
    expect(s.size).toBe(2);
    expect(s.get(other)?.fields.get(1)?.value).toBe('b');
  });
});

// ------------------------------------------------------------------ convergence properties

const devs = [DEV_A, DEV_B, id(0xc)];
const members = [id(0x51), id(0x52), id(0x53)];

const fieldValue: fc.Arbitrary<FieldValue> = fc.oneof(
  fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }),
  fc.string({ maxLength: 4 }),
  fc.boolean(),
  fc.constant(null),
  fc.uint8Array({ maxLength: 3 }),
);

let nextId = 1000;
const opArb: fc.Arbitrary<Op> = fc
  .record({
    rec: fc.constantFrom(id(1), id(2)),
    dev: fc.constantFrom(...devs),
    wallMs: fc.integer({ min: 0, max: 6 }),
    ctr: fc.integer({ min: 0, max: 2 }),
    fieldEntries: fc.array(fc.tuple(fc.constantFrom(1, 2, 3, 4, DELETED_FIELD), fieldValue), { maxLength: 4 }),
    adds: fc.array(fc.constantFrom(...members), { maxLength: 3 }),
    removeAll: fc.boolean(),
  })
  .map(({ rec, dev, wallMs, ctr, fieldEntries, adds, removeAll }) => {
    const opId = id(nextId++);
    return {
      id: opId, rec, dev, hlc: { wallMs, ctr }, table: 6,
      fields: new Map(fieldEntries),
      sets: new Map<number, SetDelta>([[10, { add: adds, rem: removeAll ? members.map((m): [Id, Id] => [m, id(nextId - 5)]) : [] }]]),
    };
  });

const opsArb = fc.array(opArb, { minLength: 0, maxLength: 12 });
const permute = <T,>(items: T[]) => fc.shuffledSubarray(items, { minLength: items.length, maxLength: items.length });

describe('convergence: the state is a function of the set of ops', () => {
  it('commutative: any delivery order gives the same state', () => {
    fc.assert(
      fc.property(opsArb.chain((ops) => fc.tuple(fc.constant(ops), permute(ops))), ([ops, shuffled]) => {
        expect(fold(...shuffled)).toEqual(fold(...ops));
      }),
    );
  });

  it('idempotent: duplicates change nothing', () => {
    fc.assert(
      fc.property(opsArb.chain((ops) => fc.tuple(fc.constant(ops), fc.subarray(ops))), ([ops, dupes]) => {
        expect(fold(...ops, ...dupes, ...ops)).toEqual(fold(...ops));
      }),
    );
  });

  it('associative: merging replica states in any grouping is the same', () => {
    fc.assert(
      fc.property(opsArb, opsArb, opsArb, (xs, ys, zs) => {
        const [a, b, c] = [fold(...xs), fold(...ys), fold(...zs)];
        expect(mergeFolds(mergeFolds(a, b), c)).toEqual(mergeFolds(a, mergeFolds(b, c)));
        expect(mergeFolds(a, b)).toEqual(mergeFolds(b, a));
        expect(mergeFolds(a, a)).toEqual(a);
      }),
    );
  });

  it('replicas that exchange state converge to the state of all ops together', () => {
    fc.assert(
      fc.property(opsArb, opsArb, (xs, ys) => {
        const merged = mergeFolds(fold(...xs), fold(...ys));
        expect(merged).toEqual(fold(...xs, ...ys));
      }),
    );
  });

  it('applyOp equals merging the single-op record state (one code path)', () => {
    fc.assert(
      fc.property(opArb, opArb, (a, b) => {
        const viaApply = applyOp(fold(a), b);
        const rec = mergeRecords(fold(a).get(a.rec) ?? recordFromOp(a), b.rec === a.rec ? recordFromOp(b) : recordFromOp(a));
        expect(viaApply.has(b.rec)).toBe(true);
        if (a.rec === b.rec) expect(viaApply.get(a.rec)).toEqual(rec);
      }),
    );
  });

  it('visible set members never include a member whose every add tag was removed', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        const s = fold(...ops);
        for (const rec of s.values()) {
          for (const m of visibleMembers(rec, 10)) {
            const tags = rec.sets.get(10)?.adds.get(m) ?? new Set();
            const removed = rec.sets.get(10)?.removed ?? new Set();
            expect([...tags].some((t) => !removed.has(t))).toBe(true);
          }
        }
      }),
    );
  });
});
