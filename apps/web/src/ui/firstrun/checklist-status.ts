'use client';

import { useEffect, useState } from 'react';
import { useCore } from '../core/CoreProvider';
import { useLedger } from '../ledger/LedgerProvider';
import { useLocalOnly } from '../sync/useLocalOnly';
import { checklistState, type Step } from './checklist';

// One definition of "getting started is done", shared by the Overview card and the Help dialog so the two cannot disagree.

export interface ChecklistStatus {
  /** False until the Fold, account and transaction counts have been read. */
  readonly known: boolean;
  readonly complete: boolean;
  readonly steps: readonly Step[];
}

export function checklistStatus(counts: { folds: number; accounts: number; transactions: number; local?: boolean; backedUp?: boolean } | undefined): ChecklistStatus {
  if (counts === undefined) return { known: false, complete: false, steps: [] };
  const { steps, complete } = checklistState(counts);
  return { known: true, complete, steps };
}

/** Reads the counts the checklist is made from, again whenever the ledger changes. */
export function useChecklistStatus(): ChecklistStatus {
  const ledger = useLedger();
  const core = useCore();
  const local = useLocalOnly();
  const [transactions, setTransactions] = useState<number | undefined>();
  // Only an account kept on this device has the backup step (spec 010), so only then is it asked whether a backup exists.
  const [backedUp, setBackedUp] = useState<boolean | undefined>();
  useEffect(() => {
    if (local !== true) return;
    let live = true;
    core.call<{ lastBackupAtMs: number }>('storage.status').then((s) => live && setBackedUp(s.lastBackupAtMs > 0), () => undefined);
    return () => { live = false; };
  }, [core, local, ledger.version]);
  useEffect(() => {
    let live = true;
    ledger.read<{ count: number }>('ledger.transactions', { filter: {}, sort: 'date_desc', page: { limit: 1, offset: 0 } }).then((r) => live && setTransactions(r.count), () => undefined);
    return () => { live = false; };
  }, [ledger.version]);
  if (ledger.basics === undefined || transactions === undefined || local === undefined || (local && backedUp === undefined)) return checklistStatus(undefined);
  return checklistStatus({ folds: ledger.folds.length, accounts: ledger.basics.accounts.length, transactions, local, backedUp: backedUp === true });
}
