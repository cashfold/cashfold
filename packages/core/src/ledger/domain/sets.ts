import type { Id } from '../../shared-kernel/id';
import type { RecordState, SetDelta } from '../../sync/domain/merge';
import { visibleMembers } from '../../sync/domain/merge';

// Helpers for building add-wins set deltas (account groups, transaction tags).

export const addMembers = (members: readonly Id[]): SetDelta => ({ add: [...new Set(members)], rem: [] });

/** Removes members by naming every add-tag the remover can currently see for them (observed-remove). */
export function removeMembers(state: RecordState | undefined, field: number, members: readonly Id[]): SetDelta {
  const set = state?.sets.get(field);
  const rem: Array<readonly [Id, Id]> = [];
  for (const member of new Set(members)) {
    for (const tag of set?.adds.get(member) ?? []) rem.push([member, tag]);
  }
  return { add: [], rem };
}

/** One delta that makes the set equal `wanted`: adds what is missing, removes what should go. */
export function setTo(state: RecordState | undefined, field: number, wanted: readonly Id[]): SetDelta {
  const current = state === undefined ? new Set<Id>() : visibleMembers(state, field);
  const want = new Set(wanted);
  const add = [...want].filter((m) => !current.has(m));
  const drop = [...current].filter((m) => !want.has(m));
  return { add, rem: removeMembers(state, field, drop).rem };
}
