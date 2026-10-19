import type { Id } from '../../shared-kernel/id';
import type { RecordState } from '../../sync/domain/merge';
import { createRepair, type Repair, type RepairReport } from '../../sync/application/repair';
import type { EventBus, ProjectionReader } from '../../sync/application/buses';
import { ledgerRepairRules } from './repair-rules';
import type { HistoryWindow } from '../../sharing/domain/checkpoint';
import { buildLedger, type Ledger } from './projections/ledger';

/** The ledger of a Fold with the repair verdicts applied: what every screen and report reads. */
export interface LedgerView {
  readonly ledger: Ledger;
  readonly report: RepairReport;
}

export interface LedgerViews {
  get(fold: Id, reader: ProjectionReader): Promise<LedgerView>;
  /** Forgets the cached view of one Fold, or of all. */
  invalidate(fold?: Id): void;
}

/**
 * Keeps one projected ledger per Fold so a screen does not re-read every record. Any domain event for the Fold
 * (local command, remote op, rebuild) drops it, and the next read builds it again. A view that was being built
 * while an event arrived is returned to its caller but not kept.
 */
export function createLedgerViews(events: EventBus, repair: Repair = createRepair(ledgerRepairRules), history?: () => HistoryWindow | undefined): LedgerViews {
  // Per Fold: every record as last read, the records that have changed since, and the view built from them. A change touches a few records, so
  // the next read re-reads those alone and rebuilds the view, instead of reading the whole Fold again (SC-008: at fifty thousand transactions the
  // difference is seconds against a fraction of a second).
  interface Entry {
    records: Promise<Map<Id, RecordState>>;
    dirty: Set<Id>;
    view: Promise<LedgerView> | undefined;
  }
  const cache = new Map<Id, Entry>();

  const invalidate = (fold?: Id): void => {
    if (fold === undefined) cache.clear();
    else cache.delete(fold);
  };
  events.subscribe((e) => {
    const entry = cache.get(e.fold);
    if (entry !== undefined) entry.dirty.add(e.rec);
  });

  return {
    invalidate,
    get(fold, reader) {
      let entry = cache.get(fold);
      if (entry === undefined) {
        const created: Entry = { records: reader.listRecords(fold).then((m) => new Map(m)), dirty: new Set(), view: undefined };
        entry = created;
        cache.set(fold, created);
        created.records.catch(() => {
          if (cache.get(fold) === created) cache.delete(fold);
        });
      }
      if (entry.view !== undefined && entry.dirty.size === 0) return entry.view;

      const current = entry;
      const changed = [...current.dirty];
      current.dirty.clear();
      const records = current.records.then(async (map) => {
        for (const rec of changed) {
          const state = await reader.getRecord(fold, rec);
          if (state === undefined) map.delete(rec);
          else map.set(rec, state);
        }
        return map;
      });
      current.records = records;
      const view = records.then((map): LedgerView => {
        const report = repair.run(map);
        return { ledger: buildLedger(map, report, history?.()), report };
      });
      current.view = view;
      view.catch(() => {
        if (cache.get(fold) === current) cache.delete(fold);
      });
      return view;
    },
  };
}
