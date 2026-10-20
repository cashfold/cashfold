import type { Store } from '../../store/store.js';

// Drops the ops a snapshot makes redundant once every active device has acknowledged it (FR-082). An acknowledgement prunes
// its own Fold at once; this sweep covers the cases nobody triggers: a device was revoked, so the rest now suffice.

export interface PruneJob {
  /** One pass over every Fold that has a snapshot. Returns how many ops were removed. */
  sweep(): Promise<number>;
  start(everyMs: number): () => void;
}

export function createPruneJob(store: Store, onError: (e: unknown) => void = () => undefined): PruneJob {
  const sweep = async (): Promise<number> => {
    let removed = 0;
    for (const fold of await store.snapshots.folds()) removed += await store.snapshots.prune(fold);
    return removed;
  };
  return {
    sweep,
    start(everyMs) {
      const timer = setInterval(() => void sweep().catch(onError), everyMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
