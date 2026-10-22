// Overview periods (FR-015): a remembered choice becomes two stated dates. Dates are `YYYY-MM-DD` text built from the integer civil date, so
// no time zone is applied twice; nothing here touches money.
import type { PeriodChoice } from '../prefs/schema';

/** A civil date as the ledger keeps it: the integer YYYYMMDD. */
export type CivilDate = number;

export interface ResolvedPeriod {
  /** Inclusive bounds as `YYYY-MM-DD`; null means unbounded. */
  from: string | null;
  to: string | null;
  labelKey: string;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const iso = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const parts = (d: CivilDate) => ({ y: Math.trunc(d / 10000), m: Math.trunc(d / 100) % 100, d: d % 100 });

/** The date `days` before the given one (inclusive counting is the caller's job). */
function minusDays(d: CivilDate, days: number): string {
  const { y, m, d: day } = parts(d);
  const t = new Date(Date.UTC(y, m - 1, day) - days * 86_400_000);
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function resolvePeriod(choice: PeriodChoice, today: CivilDate): ResolvedPeriod {
  const { y, m, d } = parts(today);
  const labelKey = `overview.period.${choice.kind}`;
  switch (choice.kind) {
    case 'thisMonth':
      return { from: iso(y, m, 1), to: iso(y, m, daysIn(y, m)), labelKey };
    case 'lastMonth': {
      const [ly, lm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: iso(ly, lm, 1), to: iso(ly, lm, daysIn(ly, lm)), labelKey };
    }
    case 'thisYear':
      return { from: iso(y, 1, 1), to: iso(y, 12, 31), labelKey };
    case 'lastYear':
      return { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31), labelKey };
    case 'last30':
      return { from: minusDays(today, 29), to: iso(y, m, d), labelKey };
    case 'last90':
      return { from: minusDays(today, 89), to: iso(y, m, d), labelKey };
    case 'all':
      return { from: null, to: null, labelKey };
    case 'custom':
      return { from: choice.from, to: choice.to, labelKey };
  }
}
