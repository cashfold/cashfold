import { describe, expect, it } from 'vitest';
import { moveWithin } from './account-order';

interface A { id: string; sortOrder: number }
const a = (id: string, sortOrder: number): A => ({ id, sortOrder });
const apply = (all: readonly A[], moves: Map<string, number>) =>
  all.map((x) => ({ ...x, sortOrder: moves.get(x.id) ?? x.sortOrder })).sort((p, q) => p.sortOrder - q.sortOrder).map((x) => x.id);

describe('moveWithin', () => {
  it('swaps an account with its neighbour in the section and keeps every other account in place', () => {
    const all = [a('p', 0), a('q', 1), a('r', 2), a('s', 3)];
    const moves = moveWithin(all, [all[1]!, all[3]!], 0, 1)!;
    expect(apply(all, moves)).toEqual(['p', 'q', 'r', 's'].map((x) => ({ p: 'p', q: 's', r: 'r', s: 'q' })[x]!));
  });

  it('keeps the whole list consistent when the sections interleave (X in A at 5, Y in B at 1, Z in A at 7)', () => {
    const all = [a('Y', 1), a('X', 5), a('Z', 7)];
    const moves = moveWithin(all, [all[1]!, all[2]!], 0, 1)!;
    expect(apply(all, moves)).toEqual(['Y', 'Z', 'X']);
    const numbers = all.map((x) => moves.get(x.id) ?? x.sortOrder);
    expect(new Set(numbers).size).toBe(3);
  });

  it('gives accounts with equal numbers distinct numbers', () => {
    const all = [a('x', 0), a('y', 0), a('z', 0)];
    const moves = moveWithin(all, all, 0, 1)!;
    const numbers = all.map((x) => moves.get(x.id) ?? x.sortOrder);
    expect(new Set(numbers).size).toBe(3);
  });

  it('returns undefined when the move would leave the section, or the section has one account', () => {
    const all = [a('x', 0), a('y', 1)];
    expect(moveWithin(all, all, 0, -1)).toBeUndefined();
    expect(moveWithin(all, all, 1, 1)).toBeUndefined();
    expect(moveWithin(all, [all[0]!], 0, 1)).toBeUndefined();
  });

  it('writes only the accounts whose number changes', () => {
    const all = [a('a', 0), a('b', 1), a('c', 2), a('d', 3)];
    expect([...moveWithin(all, all, 1, 1)!.keys()].sort()).toEqual(['b', 'c']);
  });

  it('does not change its input', () => {
    const all = [a('a', 0), a('b', 1)];
    const before = JSON.stringify(all);
    moveWithin(all, all, 0, 1);
    expect(JSON.stringify(all)).toBe(before);
  });

  it('gives the same order for a group section and a type section holding the same accounts', () => {
    const all = [a('a', 0), a('b', 1), a('c', 2), a('d', 3)];
    const section = [all[0]!, all[2]!, all[3]!];
    expect(apply(all, moveWithin(all, section, 1, 1)!)).toEqual(['a', 'b', 'd', 'c']);
    expect(apply(all, moveWithin(all, [...section], 1, 1)!)).toEqual(['a', 'b', 'd', 'c']);
  });
});
