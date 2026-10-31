import { foldLetters } from '../i18n/collation';

// The palette's matcher (spec 015, research R4): typed letters must appear in order in the target, not necessarily next to each other; case and accents
// are ignored with the same folding the rest of the app uses. It returns where the letters matched, in the target's own indices, so they can be
// highlighted. Targets are short, so the best placement is found exactly (a small table), not guessed.

export interface Match {
  /** Higher is better. 0 only for an empty query, which matches everything. */
  readonly score: number;
  /** Sorted, non-overlapping `[start, end)` ranges in the original target, in UTF-16 code units. */
  readonly ranges: readonly (readonly [number, number])[];
}

interface Folded {
  readonly chars: string[];
  /** Where each folded character starts and ends in the original text. */
  readonly from: number[];
  readonly to: number[];
}

function fold(text: string): Folded {
  const chars: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  let offset = 0;
  for (const original of text) {
    for (const c of foldLetters(original)) {
      chars.push(c);
      from.push(offset);
      to.push(offset + original.length);
    }
    offset += original.length;
  }
  return { chars, from, to };
}

const PREFIX_BONUS = 12;
const WORD_START_BONUS = 6;
const CONSECUTIVE_BONUS = 5;
const MAX_GAP_PENALTY = 3;
const LENGTH_PENALTY = 0.01;
const isWordChar = (c: string): boolean => /[\p{L}\p{N}]/u.test(c);

/** How well `query` matches `target`, or undefined if the letters do not appear in order. Spaces in the query are ignored. */
export function match(query: string, target: string): Match | undefined {
  const q = [...foldLetters(query)].filter((c) => !/\s/u.test(c));
  if (q.length === 0) return { score: 0, ranges: [] };
  const t = fold(target);
  const n = t.chars.length;
  if (q.length > n) return undefined;

  // best[i][j]: the best score with query letter i placed on target letter j; parent[i][j]: where letter i-1 went.
  const best: number[][] = q.map(() => new Array<number>(n).fill(-Infinity));
  const parent: number[][] = q.map(() => new Array<number>(n).fill(-1));
  const bonusAt = (j: number): number => (j === 0 ? WORD_START_BONUS + PREFIX_BONUS : !isWordChar(t.chars[j - 1] as string) ? WORD_START_BONUS : 0);

  for (let i = 0; i < q.length; i++) {
    for (let j = i; j < n; j++) {
      if (t.chars[j] !== q[i]) continue;
      const here = 1 + bonusAt(j);
      if (i === 0) {
        best[0]![j] = here - Math.min(j, MAX_GAP_PENALTY);
        continue;
      }
      let top = -Infinity;
      let from = -1;
      for (let k = i - 1; k < j; k++) {
        const prev = best[i - 1]![k] as number;
        if (prev === -Infinity) continue;
        const move = k === j - 1 ? CONSECUTIVE_BONUS : -Math.min(j - k - 1, MAX_GAP_PENALTY);
        if (prev + move > top) {
          top = prev + move;
          from = k;
        }
      }
      if (from >= 0) {
        best[i]![j] = top + here;
        parent[i]![j] = from;
      }
    }
  }

  const last = q.length - 1;
  let end = -1;
  let score = -Infinity;
  for (let j = last; j < n; j++) {
    if ((best[last]![j] as number) > score) {
      score = best[last]![j] as number;
      end = j;
    }
  }
  if (end < 0) return undefined;

  const placed: number[] = [];
  for (let i = last, j = end; i >= 0; j = parent[i]![j] as number, i--) placed.push(j);
  placed.reverse();

  const ranges: [number, number][] = [];
  for (const j of placed) {
    const start = t.from[j] as number;
    const stop = t.to[j] as number;
    const open = ranges[ranges.length - 1];
    if (open !== undefined && start <= open[1]) open[1] = Math.max(open[1], stop);
    else ranges.push([start, stop]);
  }
  return { score: Math.max(1, score - n * LENGTH_PENALTY), ranges };
}
