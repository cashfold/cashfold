import { Fragment, type ReactElement, type ReactNode } from 'react';
import type { Translate } from '../i18n/i18n';

// A few messages put money inside a sentence ("{spent} of {limit}", "{out} → {into}"). A message cannot hold a component, so the sentence is made with a
// marker in place of each amount and then cut at the markers, and an `<Amount>` goes in each gap. Each amount is its own revealable control, and the
// order is whatever the language chose (spec 016, research R5).

const MARK = '\u0001';

export function interleaveMessage(t: Translate, key: string, nodes: Readonly<Record<string, ReactNode>>, params: Record<string, string | number> = {}): ReactNode[] {
  const marked: Record<string, string | number> = { ...params };
  for (const name of Object.keys(nodes)) marked[name] = `${MARK}${name}${MARK}`;
  const text = t(key, marked);
  return text
    .split(MARK)
    .map((piece, index) => {
      // Pieces alternate: words, name, words, name, ...
      const part = index % 2 === 1 ? (nodes[piece] ?? null) : piece;
      return part === '' || part === null ? null : <Fragment key={index}>{part}</Fragment>;
    })
    .filter((part): part is ReactElement => part !== null);
}
