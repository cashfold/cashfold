import type { Id } from '../../shared-kernel/id';
import type { NeedsAttentionItem } from './repair';
import type { SyncFailure, SyncReport } from './sync-client';

export type SyncState = 'synced' | 'syncing' | 'offline' | 'error';

export interface FoldSyncStatus {
  readonly fold: Id;
  readonly state: SyncState;
  /** When a round last finished without a failure; undefined until one has. */
  readonly lastSyncedAtMs: number | undefined;
  /** Local changes the relay has not accepted yet. */
  readonly pendingOps: number;
  readonly failure: SyncFailure | undefined;
}

export interface SyncStatusTracker {
  begin(fold: Id): void;
  finish(fold: Id, report: SyncReport, nowMs: number, pendingOps: number): void;
  folds(): readonly FoldSyncStatus[];
  /** One state for the whole app: a problem outranks activity, which outranks being offline. */
  overall(): SyncState;
  subscribe(listener: () => void): () => void;
}

const RANK: Record<SyncState, number> = { synced: 0, offline: 1, syncing: 2, error: 3 };

export function createSyncStatus(): SyncStatusTracker {
  const byFold = new Map<Id, FoldSyncStatus>();
  const listeners = new Set<() => void>();
  const set = (s: FoldSyncStatus): void => {
    byFold.set(s.fold, s);
    for (const l of [...listeners]) l();
  };
  const initial = (fold: Id): FoldSyncStatus => ({ fold, state: 'synced', lastSyncedAtMs: undefined, pendingOps: 0, failure: undefined });

  return {
    begin(fold) {
      set({ ...(byFold.get(fold) ?? initial(fold)), state: 'syncing' });
    },
    finish(fold, report, nowMs, pendingOps) {
      const before = byFold.get(fold) ?? initial(fold);
      if (report.failure === undefined) set({ fold, state: 'synced', lastSyncedAtMs: nowMs, pendingOps, failure: undefined });
      else set({ fold, state: report.failure === 'offline' ? 'offline' : 'error', lastSyncedAtMs: before.lastSyncedAtMs, pendingOps, failure: report.failure });
    },
    folds: () => [...byFold.values()],
    overall() {
      let worst: SyncState = 'synced';
      for (const s of byFold.values()) if (RANK[s.state] > RANK[worst]) worst = s.state;
      return worst;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Needs-attention items that come from sync itself, beyond the quarantined ops (which `buildNeedsAttention` lists). */
export function syncAttention(report: SyncReport): NeedsAttentionItem[] {
  const items: NeedsAttentionItem[] = report.rejectedOps.map((r) => ({ kind: 'rejected_change', ref: r.op, messageKey: `attention.rejected.${r.reason}` }));
  if (report.failure === 'gap') items.push({ kind: 'relay_gap', messageKey: 'attention.relay_gap' });
  return items;
}
