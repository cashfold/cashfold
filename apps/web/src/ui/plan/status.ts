// Status of budgets and goals in words (FR-030, FR-042). Money stays in bigint; the progress fraction is whole basis points (1/100 of a percent)
// computed by integer division at the display edge.
export type Tone = 'neutral' | 'good' | 'warning' | 'danger';
export interface PlanStatus {
  textKey: string;
  tone: Tone;
  /** 0 to 10000. */
  progressBps: number;
}

const bps = (part: bigint, whole: bigint): number => {
  if (whole <= 0n || part <= 0n) return 0;
  const v = (part * 10_000n) / whole;
  return Number(v > 10_000n ? 10_000n : v);
};

/** On track below 80 % of the limit, near the limit from 80 % to 100 %, over beyond it. */
export function budgetStatus(spent: bigint, limit: bigint): PlanStatus {
  if (limit <= 0n) return { textKey: 'plan.status.onTrack', tone: 'good', progressBps: 0 };
  const progressBps = bps(spent, limit);
  if (spent > limit) return { textKey: 'plan.status.over', tone: 'danger', progressBps: 10_000 };
  if (spent * 10n >= limit * 8n) return { textKey: 'plan.status.near', tone: 'warning', progressBps };
  return { textKey: 'plan.status.onTrack', tone: 'good', progressBps };
}

/** `dueDate` and `today` are comparable civil dates (YYYYMMDD) or null when the goal has no date. */
export function goalStatus(saved: bigint, target: bigint, dueDate: number | null, today: number): PlanStatus {
  const progressBps = bps(saved, target);
  if (target > 0n && saved >= target) return { textKey: 'plan.status.reached', tone: 'good', progressBps: 10_000 };
  if (dueDate !== null && today > dueDate) return { textKey: 'plan.status.overdue', tone: 'danger', progressBps };
  return { textKey: 'plan.status.inProgress', tone: 'neutral', progressBps };
}
