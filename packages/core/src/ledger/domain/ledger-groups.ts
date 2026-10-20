import type { GroupRegistry } from '../../sync/domain/merge';
import { SCHEDULE_TRANSFER_GROUP, SCHEDULE_TXN_GROUP, TABLE, TRANSFER_GROUP, TXN_AMOUNT_GROUP } from './tables';

/** Field groups the write path enforces for ledger records: an op writes all of a group or none (FR-032). */
export const LEDGER_GROUPS: GroupRegistry = new Map<number, readonly (readonly number[])[]>([
  [TABLE.transaction, [TXN_AMOUNT_GROUP]],
  [TABLE.transfer, [TRANSFER_GROUP]],
  [TABLE.schedule, [SCHEDULE_TXN_GROUP, SCHEDULE_TRANSFER_GROUP]],
]);

/** Whether the registry holds a group with exactly these fields (used by tests that pin the wire format). */
export const ledgerGroupsHave = (table: number, fields: readonly number[]): boolean =>
  (LEDGER_GROUPS.get(table) ?? []).some((g) => g.length === fields.length && g.every((f) => fields.includes(f)));
