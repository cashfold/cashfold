interface Ordered {
  readonly id: string;
  readonly sortOrder: number;
}

/**
 * Swaps `section[index]` with its neighbour `delta` away inside the full list `all` (in saved order), renumbers `all` from 0 and returns only the
 * accounts whose number changed. Ties in `sortOrder` keep the order `all` is given in. `undefined` when the move would leave the section.
 */
export function moveWithin(all: readonly Ordered[], section: readonly Ordered[], index: number, delta: -1 | 1): Map<string, number> | undefined {
  const other = index + delta;
  const mine = section[index];
  const neighbour = section[other];
  if (mine === undefined || neighbour === undefined) return undefined;
  const order = all.map((x, position) => ({ x, position })).sort((p, q) => p.x.sortOrder - q.x.sortOrder || p.position - q.position).map((e) => e.x);
  const i = order.findIndex((x) => x.id === mine.id);
  const j = order.findIndex((x) => x.id === neighbour.id);
  if (i < 0 || j < 0) return undefined;
  [order[i], order[j]] = [order[j]!, order[i]!];
  const moves = new Map<string, number>();
  for (const [position, x] of order.entries()) if (x.sortOrder !== position) moves.set(x.id, position);
  return moves;
}
