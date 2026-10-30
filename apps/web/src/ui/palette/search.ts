import { foldLetters } from '../i18n/collation';
import { match, type Match } from './fuzzy';
import { TYPE_ORDER, type PaletteEntry } from './entry';

export interface Result {
  readonly entry: PaletteEntry;
  /** Where the query matched in the title, for highlighting. Undefined when only a hidden keyword matched, or the query is empty. */
  readonly title: Match | undefined;
  readonly score: number;
}

/** A match on a hidden keyword counts for less than the same match on the title. */
const KEYWORD_WEIGHT = 0.5;
const KEYWORD_PREFIX = 10;
const KEYWORD_INSIDE = 5;

/**
 * How well the query fits the hidden keywords of an entry: a word that starts with it counts most, a word that contains it less. The letters must be
 * together here, unlike the title, so a short query does not match a pile of unrelated words.
 */
function keywordScore(query: string, keywords: readonly string[]): number {
  const wanted = foldLetters(query).replace(/\s+/gu, '');
  if (wanted === '') return 0;
  let best = 0;
  for (const keyword of keywords) {
    for (const word of foldLetters(keyword).split(/\s+/u)) {
      if (word.startsWith(wanted)) best = Math.max(best, KEYWORD_PREFIX);
      else if (word.includes(wanted)) best = Math.max(best, KEYWORD_INSIDE);
    }
  }
  return best;
}
export const MAX_RESULTS = 20;

/**
 * The entries that match, best first. Ties go to the one used more often (`usage`: entry id to count), then to screens before actions before the
 * person's own items, then to the shorter title. An empty query keeps every entry in the order given. At most `limit` are returned.
 */
export function searchEntries(entries: readonly PaletteEntry[], query: string, usage: ReadonlyMap<string, number> = new Map(), limit = MAX_RESULTS): Result[] {
  const found: Result[] = [];
  for (const entry of entries) {
    const onTitle = match(query, entry.title);
    if (onTitle !== undefined) {
      found.push({ entry, title: onTitle.ranges.length === 0 ? undefined : onTitle, score: onTitle.score });
      continue;
    }
    const keyword = keywordScore(query, entry.keywords);
    if (keyword > 0) found.push({ entry, title: undefined, score: keyword * KEYWORD_WEIGHT });
  }
  if (query.trim() === '') return found.slice(0, limit);
  found.sort(
    (a, b) =>
      b.score - a.score ||
      (usage.get(b.entry.id) ?? 0) - (usage.get(a.entry.id) ?? 0) ||
      TYPE_ORDER[a.entry.type] - TYPE_ORDER[b.entry.type] ||
      a.entry.title.length - b.entry.title.length,
  );
  return found.slice(0, limit);
}
