import type { Id } from '../../shared-kernel/id';
import type { OpLogStore, ProjectionStore } from '../../sync/ports/index';
import { deletedAtMs } from '../domain/records';
import { RETENTION_MS } from './transaction-commands';

export interface PurgeDeps {
  readonly oplog: OpLogStore;
  readonly projections: ProjectionStore;
}

/**
 * Permanently removes records that were deleted 30 or more days ago (FR-052). The test is the *tombstone's own
 * clock*, the wall time of the write that deleted the record, so every device reaches the same verdict no matter
 * when it learned of the delete. Purging erases the record, its field history and the payload of its ops, and
 * remembers the record id so a late op for it is quarantined instead of resurrecting it. Idempotent.
 *
 * Returns the ids it purged, in a stable order. Discarding the matching history on the relay waits until every
 * active device has confirmed (the sync story).
 */
export async function purgeExpired(deps: PurgeDeps, fold: Id, nowMs: number): Promise<readonly Id[]> {
  return deps.projections.transaction(async () => {
    const due: Id[] = [];
    for (const [rec, state] of await deps.projections.listRecords(fold)) {
      const at = deletedAtMs(state);
      if (at !== undefined && nowMs - at >= RETENTION_MS) due.push(rec);
    }
    due.sort();
    for (const rec of due) {
      await deps.oplog.scrub(fold, rec);
      await deps.projections.purgeRecord(fold, rec, nowMs);
    }
    return due;
  });
}
