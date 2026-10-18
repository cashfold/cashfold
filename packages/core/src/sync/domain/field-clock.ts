import type { Id } from '../../shared-kernel/id.js';
import { compareStamp, type Hlc } from './hlc.js';

export type FieldValue = bigint | string | Uint8Array | boolean | null | readonly FieldValue[] | { readonly [key: string]: FieldValue };

/** The register written by one operation: its value and the clock metadata that orders it against rivals. */
export interface FieldEntry {
  readonly hlc: Hlc;
  readonly dev: Id;
  readonly opId: Id;
  readonly value: FieldValue;
}

/**
 * Last-writer-wins order: `(wall, ctr, dev)`, then op id. A device never stamps two ops identically,
 * so the op id only matters for buggy or hostile input; it keeps the order total so replicas still agree.
 */
export function compareEntries(a: FieldEntry, b: FieldEntry): number {
  const byStamp = compareStamp(a, b);
  if (byStamp !== 0) return byStamp;
  return a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0;
}

export const winner = (a: FieldEntry, b: FieldEntry): FieldEntry => (compareEntries(a, b) >= 0 ? a : b);
