import type { RowAction } from '../ledger/row-action';

export interface TransactionActionLabels {
  readonly edit: string;
  readonly pin: string;
  readonly unpin: string;
  readonly remove: string;
}

/** What a transaction row offers, in order: edit, pin or unpin, delete. */
export function transactionActions(input: { readonly pinned: boolean; readonly labels: TransactionActionLabels; readonly edit: () => void; readonly togglePin: () => void; readonly remove: () => void }): RowAction[] {
  return [
    { id: 'edit', label: input.labels.edit, run: input.edit },
    input.pinned ? { id: 'unpin', label: input.labels.unpin, run: input.togglePin } : { id: 'pin', label: input.labels.pin, run: input.togglePin },
    { id: 'delete', label: input.labels.remove, run: input.remove, destructive: true },
  ];
}

/** What a transfer row offers, in order: edit, delete. */
export function transferActions(input: { readonly labels: Pick<TransactionActionLabels, 'edit' | 'remove'>; readonly edit: () => void; readonly remove: () => void }): RowAction[] {
  return [
    { id: 'edit', label: input.labels.edit, run: input.edit },
    { id: 'delete', label: input.labels.remove, run: input.remove, destructive: true },
  ];
}
