import type { GroupRegistry } from '../../sync/domain/merge';
import { TABLE, TXN_AMOUNT_GROUP } from './tables';

/** Field groups the write path enforces for ledger records: an op writes all of a group or none (FR-032). */
export const LEDGER_GROUPS: GroupRegistry = new Map<number, readonly (readonly number[])[]>([
  [TABLE.transaction, [TXN_AMOUNT_GROUP]],
]);
