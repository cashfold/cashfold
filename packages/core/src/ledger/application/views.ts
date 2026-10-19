import type { Id } from '../../shared-kernel/id';
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
  const cache = new Map<Id, Promise<LedgerView>>();
  const versions = new Map<Id, number>();
  const versionOf = (fold: Id): number => versions.get(fold) ?? 0;

  const invalidate = (fold?: Id): void => {
    if (fold === undefined) {
      for (const f of cache.keys()) versions.set(f, versionOf(f) + 1);
      cache.clear();
      return;
    }
    versions.set(fold, versionOf(fold) + 1);
    cache.delete(fold);
  };
  events.subscribe((e) => invalidate(e.fold));

  return {
    invalidate,
    get(fold, reader) {
      const cached = cache.get(fold);
      if (cached !== undefined) return cached;
      const startedAt = versionOf(fold);
      const building = reader.listRecords(fold).then((records): LedgerView => {
        const report = repair.run(records);
        return { ledger: buildLedger(records, report, history?.()), report };
      });
      cache.set(fold, building);
      const forget = (): void => {
        if (versionOf(fold) !== startedAt && cache.get(fold) === building) cache.delete(fold);
      };
      building.then(forget, () => {
        if (cache.get(fold) === building) cache.delete(fold);
      });
      return building;
    },
  };
}
