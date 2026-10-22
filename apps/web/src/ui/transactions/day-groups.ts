// The day groups of the transaction list (data-model §3 DayGroup). Rows arrive newest first. Each group's net is the exact sum of its loaded rows in
// signed minor units; only the last group can be incomplete, and only while more rows exist than have been loaded (so its total says "so far").
export interface DayRow {
  localDate: number;
  amountMinor: bigint;
}
export interface DayGroup<R extends DayRow> {
  date: number;
  items: R[];
  netMinor: bigint;
  partial: boolean;
}

export function groupByDay<R extends DayRow>(rows: readonly R[], totalCount: number): DayGroup<R>[] {
  const groups: DayGroup<R>[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last?.date === row.localDate) {
      last.items.push(row);
      last.netMinor += row.amountMinor;
    } else groups.push({ date: row.localDate, items: [row], netMinor: row.amountMinor, partial: false });
  }
  const last = groups.at(-1);
  if (last && totalCount > rows.length) last.partial = true;
  return groups;
}
