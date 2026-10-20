'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { DataScreen } from '../../ui/data/DataScreen';
import { LedgerProvider } from '../../ui/ledger/LedgerProvider';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.data.title">
      <LedgerProvider>
        <DataScreen />
      </LedgerProvider>
    </RequireUnlocked>
  );
}
