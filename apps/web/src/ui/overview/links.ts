// Where a row of the Overview leads (FR-016): the Transactions list filtered to that row and the period shown.
export interface BreakdownRow {
  kind: 'category' | 'tag' | 'account';
  id: string;
}

export function breakdownHref(row: BreakdownRow, period: { from: string | null; to: string | null }): string {
  const query = new URLSearchParams();
  query.set(row.kind, row.id);
  if (period.from !== null) query.set('from', period.from);
  if (period.to !== null) query.set('to', period.to);
  return `/transactions/?${query.toString()}`;
}
