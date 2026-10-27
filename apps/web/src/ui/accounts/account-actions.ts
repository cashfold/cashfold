import type { RowAction } from '../ledger/row-action';

export interface AccountActionLabels {
  readonly add: string;
  readonly adjust: string;
  readonly edit: string;
  readonly moveUp: string;
  readonly moveDown: string;
  readonly archive: string;
  readonly unarchive: string;
  readonly remove: string;
}

/** What an account row offers, in order: add a transaction, adjust the balance, edit, move up, move down, archive or restore, delete. */
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
  readonly toggleArchived: () => void;
  readonly remove: () => void;
}): RowAction[] {
  return [
    { id: 'add', label: input.labels.add, run: input.add },
    { id: 'adjust', label: input.labels.adjust, run: input.adjust },
    { id: 'edit', label: input.labels.edit, run: input.edit },
    { id: 'move-up', label: input.labels.moveUp, run: () => input.move(-1), disabled: input.index === 0 },
    { id: 'move-down', label: input.labels.moveDown, run: () => input.move(1), disabled: input.index === input.count - 1 },
    input.archived ? { id: 'unarchive', label: input.labels.unarchive, run: input.toggleArchived } : { id: 'archive', label: input.labels.archive, run: input.toggleArchived },
    { id: 'delete', label: input.labels.remove, run: input.remove, destructive: true },
  ];
}
