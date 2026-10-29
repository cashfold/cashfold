import type { RowAction } from '../ledger/row-action';

export interface AccountActionLabels {
  readonly add: string;
  readonly adjust: string;
  readonly edit: string;
  readonly moveUp: string;
  readonly moveDown: string;
  readonly moveToGroup: (name: string) => string;
  readonly moveToUngrouped: string;
  readonly currentGroup: (name: string) => string;
  readonly currentUngrouped: string;
  readonly archive: string;
  readonly unarchive: string;
  readonly remove: string;
}

/**
 * What an account row offers, in order: add a transaction, adjust the balance, edit, move to each group (and out of its group), move up, move down,
 * archive or restore, delete.
 */
export function accountActions(input: {
  readonly archived: boolean;
  /** Position among the accounts of its kind. */
  readonly index: number;
  readonly count: number;
  readonly labels: AccountActionLabels;
  readonly add: () => void;
  readonly adjust: () => void;
  readonly edit: () => void;
  readonly move: (direction: -1 | 1) => void;
  /** The groups that exist, in order. Without any, there are no move-to-group actions. */
  readonly groups?: readonly { readonly id: string; readonly name: string }[];
  /** The group the account is shown under, if any. */
  readonly currentGroup?: string | undefined;
  readonly moveToGroup?: (group: string | null) => void;
  readonly toggleArchived: () => void;
  readonly remove: () => void;
}): RowAction[] {
  const groups = input.groups ?? [];
  const moveToGroup = input.moveToGroup ?? (() => undefined);
  const moves: RowAction[] = groups.length === 0 ? [] : [
    ...groups.map((g): RowAction => (g.id === input.currentGroup
      ? { id: `move-to:${g.id}`, label: input.labels.currentGroup(g.name), run: () => moveToGroup(g.id), disabled: true }
      : { id: `move-to:${g.id}`, label: input.labels.moveToGroup(g.name), run: () => moveToGroup(g.id) })),
    input.currentGroup === undefined
      ? { id: 'move-to:none', label: input.labels.currentUngrouped, run: () => moveToGroup(null), disabled: true }
      : { id: 'move-to:none', label: input.labels.moveToUngrouped, run: () => moveToGroup(null) },
  ];
  return [
    { id: 'add', label: input.labels.add, run: input.add },
    { id: 'adjust', label: input.labels.adjust, run: input.adjust },
    { id: 'edit', label: input.labels.edit, run: input.edit },
    ...moves,
    { id: 'move-up', label: input.labels.moveUp, run: () => input.move(-1), disabled: input.index === 0 },
    { id: 'move-down', label: input.labels.moveDown, run: () => input.move(1), disabled: input.index === input.count - 1 },
    input.archived ? { id: 'unarchive', label: input.labels.unarchive, run: input.toggleArchived } : { id: 'archive', label: input.labels.archive, run: input.toggleArchived },
    { id: 'delete', label: input.labels.remove, run: input.remove, destructive: true },
  ];
}
