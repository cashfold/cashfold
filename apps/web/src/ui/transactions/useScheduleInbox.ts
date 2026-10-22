'use client';

import type { PendingOccurrence } from '@cashfold/core';
import { useEffect, useState } from 'react';
import { useLedger } from '../ledger/LedgerProvider';

/** The scheduled entries waiting for the person's confirmation (schedules that ask first), read again after every change. */
export function useScheduleInbox(): PendingOccurrence[] {
  const ledger = useLedger();
  const [pending, setPending] = useState<PendingOccurrence[]>([]);
  useEffect(() => {
    if (ledger.fold === undefined) return;
    let live = true;
    ledger.read<PendingOccurrence[]>('schedules.pending').then((p) => live && setPending(p), () => undefined);
    return () => { live = false; };
  }, [ledger.version, ledger.fold?.id]);
  return pending;
}
