import type { RowAction } from './row-action';

export interface CategoryActionLabels {
  readonly edit: string;
  readonly addChild: string;
  readonly moveUp: string;
  readonly moveDown: string;
  readonly merge: string;
  readonly archive: string;
  readonly unarchive: string;
  readonly remove: string;
}

/**
 * What a category row offers, in order: edit, add a subcategory (a top-level category only), move up, move down, merge, archive or restore, delete.
 * One list serves the row's "actions" button and the desktop app's right-click menu, as for the other rows (spec 006, FR-012).
 */
export function categoryActions(input: {
  readonly archived: boolean;
  /** Position among its siblings. */
  readonly index: number;
  readonly count: number;
  readonly labels: CategoryActionLabels;
  readonly edit: () => void;
  /** Absent for a subcategory: categories have two levels at most. */
  readonly addChild?: () => void;
  readonly move: (direction: -1 | 1) => void;
  readonly merge: () => void;
  readonly toggleArchived: () => void;
  readonly remove: () => void;
}): RowAction[] {
  return [
    { id: 'edit', label: input.labels.edit, run: input.edit },
    ...(input.addChild === undefined ? [] : [{ id: 'add-child', label: input.labels.addChild, run: input.addChild }]),
    { id: 'move-up', label: input.labels.moveUp, run: () => input.move(-1), disabled: input.index === 0 },
    { id: 'move-down', label: input.labels.moveDown, run: () => input.move(1), disabled: input.index === input.count - 1 },
    { id: 'merge', label: input.labels.merge, run: input.merge },
    input.archived ? { id: 'unarchive', label: input.labels.unarchive, run: input.toggleArchived } : { id: 'archive', label: input.labels.archive, run: input.toggleArchived },
    { id: 'delete', label: input.labels.remove, run: input.remove, destructive: true },
  ];
}

/** What a payee or tag row offers: edit, merge, delete. */
export function labelActions(input: { readonly labels: Pick<CategoryActionLabels, 'edit' | 'merge' | 'remove'>; readonly edit: () => void; readonly merge: () => void; readonly remove: () => void }): RowAction[] {
  return [
    { id: 'edit', label: input.labels.edit, run: input.edit },
    { id: 'merge', label: input.labels.merge, run: input.merge },
    { id: 'delete', label: input.labels.remove, run: input.remove, destructive: true },
  ];
}
