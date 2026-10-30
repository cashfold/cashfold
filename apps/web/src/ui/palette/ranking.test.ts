import { describe, expect, it } from 'vitest';
import type { EntryType, PaletteEntry } from './entry';
import type { HistoryItem } from './history';
import { emptyQuerySections, FREQUENT_COUNT, MAIN_SCREEN_IDS, RECENT_COUNT, usageOf } from './ranking';

const entry = (id: string, type: EntryType = 'account'): PaletteEntry => ({ id, type, title: id, keywords: [], run: () => undefined });
const headings = { recent: 'Recent', frequent: 'Frequent', screen: 'Screens', action: 'Actions' };
const item = (id: string, n: number, t: number): HistoryItem => ({ id, n, t });
const ids = (sections: ReturnType<typeof emptyQuerySections>, key: string) => sections.find((s) => s.key === key)?.rows.map((r) => r.entry.id);

const ENTRIES = [...MAIN_SCREEN_IDS.map((id) => entry(id, 'screen')), entry('c:lock-now', 'action'), entry('c:help', 'action'), ...['a:1', 'a:2', 'a:3', 'a:4', 'a:5', 'a:6', 'a:7', 'a:8', 'a:9'].map((id) => entry(id))];

describe('what the palette shows before anything is typed', () => {
  it('lists Recent newest first, up to five', () => {
    const history = Array.from({ length: 8 }, (_, i) => item(`a:${i + 1}`, 1, 100 + i));
    expect(ids(emptyQuerySections(ENTRIES, history, headings), 'recent')).toEqual(['a:8', 'a:7', 'a:6', 'a:5', 'a:4'].slice(0, RECENT_COUNT));
  });

  it('lists Frequent most used first, up to five, never repeating a Recent item', () => {
    const history = [item('a:1', 50, 1), item('a:2', 40, 2), item('a:3', 30, 3), item('a:4', 20, 4), item('a:5', 10, 5), item('a:6', 9, 6), item('a:7', 8, 7), item('a:8', 7, 8), item('a:9', 1, 900)];
    const sections = emptyQuerySections(ENTRIES, history, headings);
    expect(ids(sections, 'recent')).toEqual(['a:9', 'a:8', 'a:7', 'a:6', 'a:5']);
    expect(ids(sections, 'frequent')).toEqual(['a:1', 'a:2', 'a:3', 'a:4']);
    expect(ids(sections, 'frequent')!.length).toBeLessThanOrEqual(FREQUENT_COUNT);
    const all = sections.flatMap((s) => s.rows.map((r) => r.entry.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it('breaks a tie in use by the later time', () => {
    const newest = ['a:3', 'a:4', 'a:5', 'a:6', 'a:7'].map((id, i) => item(id, 1, 100 + i));
    const sections = emptyQuerySections(ENTRIES, [item('a:1', 3, 10), item('a:2', 3, 20), ...newest], headings);
    expect(ids(sections, 'frequent')).toEqual(['a:2', 'a:1']);
  });

  it('skips an entry that no longer exists, is not in this Fold, or is not available', () => {
    const history = [item('a:gone', 9, 999), item('g:other-fold', 9, 998), item('a:1', 1, 1)];
    const sections = emptyQuerySections(ENTRIES, history, headings);
    expect(ids(sections, 'recent')).toEqual(['a:1']);
    expect(ids(sections, 'frequent')).toBeUndefined();
  });

  it('shows the main screens and the common actions when there is no history', () => {
    const sections = emptyQuerySections(ENTRIES, [], headings);
    expect(sections.map((s) => s.key)).toEqual(['screen', 'action']);
    expect(ids(sections, 'screen')).toEqual([...MAIN_SCREEN_IDS]);
    expect(ids(sections, 'action')).toEqual(['c:lock-now', 'c:help']);
  });

  it('shows them too when every remembered entry is gone', () => {
    expect(emptyQuerySections(ENTRIES, [item('a:gone', 3, 3)], headings).map((s) => s.key)).toEqual(['screen', 'action']);
  });

  it('shows only what exists: no actions means no action heading', () => {
    const sections = emptyQuerySections(MAIN_SCREEN_IDS.map((id) => entry(id, 'screen')), [], headings);
    expect(sections.map((s) => s.key)).toEqual(['screen']);
  });

  it('turns history into the counts used to order equal matches', () => {
    expect(usageOf([item('a:1', 4, 1), item('a:2', 2, 2)])).toEqual(new Map([['a:1', 4], ['a:2', 2]]));
  });
});
