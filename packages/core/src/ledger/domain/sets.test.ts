import { describe, expect, it } from 'vitest';
import { applyOp, emptyFold, visibleMembers, type Op } from '../../sync/domain/merge';
import { id } from '../../testing/index';
import { addMembers, removeMembers, setTo } from './sets';

const REC = id(1);
let n = 0;
const apply = (state: ReturnType<typeof emptyFold>, delta: ReturnType<typeof addMembers>) => {
  const op: Op = { id: id(100 + ++n), rec: REC, dev: id(0xa), hlc: { wallMs: n, ctr: 0 }, table: 6, fields: new Map(), sets: new Map([[1, delta]]) };
  return applyOp(state, op);
};
const members = (state: ReturnType<typeof emptyFold>) => [...visibleMembers(state.get(REC)!, 1)].sort();

describe('set deltas', () => {
  it('adds each member once', () => {
    expect(addMembers([id(5), id(5), id(6)])).toEqual({ add: [id(5), id(6)], rem: [] });
  });

  it('removes only members that are there, by naming every add they were seen under', () => {
    let state = apply(emptyFold(), addMembers([id(5), id(6)]));
    state = apply(state, addMembers([id(5)])); // a second add of 5 under another tag
    const rem = removeMembers(state.get(REC), 1, [id(5), id(9)]);
    expect(rem.add).toEqual([]);
    expect(rem.rem.filter(([m]) => m === id(5))).toHaveLength(2);
    expect(rem.rem.some(([m]) => m === id(9))).toBe(false);
    expect(members(apply(state, rem))).toEqual([id(6)]);
  });

  it('removing from a record that does not exist removes nothing', () => {
    expect(removeMembers(undefined, 1, [id(5)])).toEqual({ add: [], rem: [] });
  });

  it('setTo adds what is missing and removes what should go, and nothing else', () => {
    let state = apply(emptyFold(), addMembers([id(5), id(6)]));
    const delta = setTo(state.get(REC), 1, [id(6), id(7)]);
    expect(delta.add).toEqual([id(7)]);
    state = apply(state, delta);
    expect(members(state)).toEqual([id(6), id(7)]);
    expect(setTo(state.get(REC), 1, [id(6), id(7)])).toEqual({ add: [], rem: [] });
    expect(setTo(undefined, 1, [id(1)])).toEqual({ add: [id(1)], rem: [] });
  });
});
