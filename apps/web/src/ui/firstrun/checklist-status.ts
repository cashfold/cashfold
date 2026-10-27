'use client';

import { useEffect, useState } from 'react';
import { useLedger } from '../ledger/LedgerProvider';
import { checklistState, type Step } from './checklist';

// One definition of "getting started is done", shared by the Overview card and the Help dialog so the two cannot disagree.

export interface ChecklistStatus {
  /** False until the Fold, account and transaction counts have been read. */
  readonly known: boolean;
  readonly complete: boolean;
  readonly steps: readonly Step[];
}

export function checklistStatus(counts: { folds: number; accounts: number; transactions: number } | undefined): ChecklistStatus {
  if (counts === undefined) return { known: false, complete: false, steps: [] };
  const { steps, complete } = checklistState(counts);
  return { known: true, complete, steps };
}

/** Reads the counts the checklist is made from, again whenever the ledger changes. */
export function useChecklistStatus(): ChecklistStatus {
  const ledger = useLedger();
  const [transactions, setTransactions] = useState<number | undefined>();
  useEffect(() => {
    let live = true;
    ledger.read<{ count: number }>('ledger.transactions', { filter: {}, sort: 'date_desc', page: { limit: 1, offset: 0 } }).then((r) => live && setTransactions(r.count), () => undefined);
    return () => { live = false; };
  }, [ledger.version]);
  if (ledger.basics === undefined || transactions === undefined) return checklistStatus(undefined);
  return checklistStatus({ folds: ledger.folds.length, accounts: ledger.basics.accounts.length, transactions });
}
