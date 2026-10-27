'use client';

import type { PendingOccurrence } from '@cashfold/core';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getDesktopBridge } from '../../adapters/platform';
import { useLedger } from '../ledger/LedgerProvider';
import { clearPresence, recentFoldsOf, sendPresence, waitingCount } from './desktop-presence';

const REFRESH_MS = 60_000;

/**
 * In the unlocked shell, desktop app only: keeps the dock or taskbar count and the shell's recent Folds up to date, and clears them when the session
 * ends. The count is read again on every change of the ledger, whenever the person moves to another screen, and every minute, because entries also
 * come due with the passing of time and nothing in the ledger changes then.
 */
export default function DesktopPresence() {
  const ledger = useLedger();
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const foldId = ledger.fold?.id;
  const folds = JSON.stringify(recentFoldsOf(ledger.folds, foldId));

  useEffect(() => {
    if (foldId === undefined) return;
    let live = true;
    const read = (): void => {
      ledger.read<PendingOccurrence[]>('schedules.pending').then(
        (pending) => live && setCount(waitingCount(pending)),
        () => undefined,
      );
    };
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
    // `ledger` changes identity with its data; the version and the Fold are what matter.
  }, [ledger.version, foldId, pathname]);

  useEffect(() => {
    void sendPresence(getDesktopBridge(), count, JSON.parse(folds) as Array<{ id: string; name: string }>);
  }, [count, folds]);

  // The unlocked shell is gone when the app locks: nothing may stay on the dock, the taskbar or in a menu.
  useEffect(() => () => void clearPresence(getDesktopBridge()), []);
  return null;
}
