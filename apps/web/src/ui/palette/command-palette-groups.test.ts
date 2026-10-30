import { describe, expect, it } from 'vitest';
import { groupByType, highlight } from './CommandPalette';
import type { EntryType, PaletteEntry } from './entry';
import type { Result } from './search';

const result = (id: string, type: EntryType, score: number): Result => ({ entry: { id, type, title: id, keywords: [], run: () => undefined } satisfies PaletteEntry, title: undefined, score });
const heading = (type: EntryType) => type;

describe('grouping the matches', () => {
  it('puts the group with the best match first, and a fixed order among equals', () => {
    const groups = groupByType([result('c:go', 'screen', 5), result('a:1', 'account', 40), result('a:2', 'account', 10), result('g:1', 'goal', 5)], heading);
    expect(groups.map((g) => g.key)).toEqual(['account', 'screen', 'goal']);
    expect(groups[0]!.rows.map((r) => r.entry.id)).toEqual(['a:1', 'a:2']);
  });

  it('keeps the fixed order when nothing is typed (every score is equal)', () => {
    const groups = groupByType([result('g:1', 'goal', 0), result('a:1', 'account', 0), result('c:lock', 'action', 0), result('c:go', 'screen', 0), result('e:1', 'envelope', 0)], heading);
    expect(groups.map((g) => g.key)).toEqual(['screen', 'action', 'account', 'envelope', 'goal']);
  });
});

describe('highlighting a title', () => {
  it('cuts it into plain and matched pieces', () => {
    expect(highlight('Checking', { score: 1, ranges: [[0, 2], [6, 7]] })).toEqual([
      { text: 'Ch', matched: true }, { text: 'ecki', matched: false }, { text: 'n', matched: true }, { text: 'g', matched: false },
    ]);
  });

  it('leaves it whole with no match or an empty one', () => {
    expect(highlight('Checking', undefined)).toEqual([{ text: 'Checking', matched: false }]);
    expect(highlight('Checking', { score: 0, ranges: [] })).toEqual([{ text: 'Checking', matched: false }]);
  });
});
