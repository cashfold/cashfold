'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { LedgerProvider } from '../../ui/ledger/LedgerProvider';
import { TransfersScreen } from '../../ui/ledger/transfer/TransfersScreen';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.transfers.title">
      <LedgerProvider>
        <TransfersScreen />
      </LedgerProvider>
    </RequireUnlocked>
  );
}
