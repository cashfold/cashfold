import { ceilDiv, compareText } from '../../domain/util';
import { RETENTION_MS } from '../transaction-commands';
import type { DeletedTransaction, Ledger } from '../projections/ledger';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecentlyDeleted extends DeletedTransaction {
  /** Whole days left to restore it, counting a started day as a day. */
  readonly daysLeft: number;
}

/** Deleted transactions that can still be restored, most recently deleted first (FR-052). */
export function recentlyDeleted(ledger: Ledger, nowMs: number): RecentlyDeleted[] {
  return [...ledger.deleted.values()]
    .map((d) => ({ ...d, daysLeft: ceilDiv(d.deletedAtMs + RETENTION_MS - nowMs, DAY_MS) }))
    .filter((d) => d.deletedAtMs + RETENTION_MS - nowMs > 0)
    .sort((a, b) => b.deletedAtMs - a.deletedAtMs || compareText(a.transaction.id, b.transaction.id));
}
