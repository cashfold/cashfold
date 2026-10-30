import { describe, expect, it } from 'vitest';
import type { EntryType, PaletteEntry } from './entry';
import { MAX_RESULTS, searchEntries } from './search';

const entry = (id: string, title: string, type: EntryType = 'account', keywords: string[] = []): PaletteEntry => ({ id, type, title, keywords, run: () => undefined });

describe('searching the palette entries', () => {
  const entries = [entry('c:go-settings', 'Settings', 'screen', ['preferences']), entry('a:1', 'Savings'), entry('a:2', 'My savings'), entry('g:1', 'Holiday', 'goal')];

  it('keeps everything, in the order given, for an empty query', () => {
    expect(searchEntries(entries, '').map((r) => r.entry.id)).toEqual(['c:go-settings', 'a:1', 'a:2', 'g:1']);
  });

  it('orders by how well the title matches', () => {
    expect(searchEntries(entries, 'sav').map((r) => r.entry.id)).toEqual(['a:1', 'a:2']);
  });

  it('returns the highlight ranges for a title match', () => {
    expect(searchEntries(entries, 'hol')[0]!.title?.ranges).toEqual([[0, 3]]);
  });

  it('finds an entry by a hidden keyword, without a highlight, below a title match', () => {
    const found = searchEntries(entries, 'prefer');
    expect(found.map((r) => r.entry.id)).toEqual(['c:go-settings']);
    expect(found[0]!.title).toBeUndefined();
  });

  it('matches a hidden keyword only when its letters are together, so a short query does not find unrelated words', () => {
    const action = entry('c:add', 'Add transaction', 'action', ['new expense income transfer']);
    expect(searchEntries([action], 'cafe')).toEqual([]);
    expect(searchEntries([action], 'expen')).toHaveLength(1);
    expect(searchEntries([action], 'ense')).toHaveLength(1);
  });

  it('breaks a tie by use, then by type, then by the shorter title', () => {
    const tied = [entry('a:1', 'Cash', 'account'), entry('c:go-cash', 'Cash', 'screen'), entry('a:2', 'Cash', 'account')];
    expect(searchEntries(tied, 'cash').map((r) => r.entry.id)).toEqual(['c:go-cash', 'a:1', 'a:2']);
    expect(searchEntries(tied, 'cash', new Map([['a:2', 5]])).map((r) => r.entry.id)).toEqual(['a:2', 'c:go-cash', 'a:1']);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchEntries(entries, 'zzz')).toEqual([]);
  });

  it('returns at most the limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => entry(`a:${i}`, `Account ${i}`));
    expect(searchEntries(many, 'acc')).toHaveLength(MAX_RESULTS);
    expect(searchEntries(many, '', undefined, 5)).toHaveLength(5);
  });

  it('answers quickly with 600 entries, so a keystroke shows its results within a frame on any normal computer', () => {
    const many = Array.from({ length: 600 }, (_, i) => entry(`a:${i}`, `Account number ${i} with a longer name`, 'account', ['some hidden words']));
    searchEntries(many, 'acc'); // warm up
    const started = performance.now();
    for (const query of ['a', 'ac', 'acc', 'acco', 'account 5', 'longer', 'zzz']) searchEntries(many, query);
    const each = (performance.now() - started) / 7;
    // A generous bound: the aim is a frame (16 ms); this catches a slowdown by a factor of several, not a busy machine.
    expect(each).toBeLessThan(100);
  });
});
