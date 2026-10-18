'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { DashboardScreen } from '../../ui/ledger/DashboardScreen';
import { LedgerProvider } from '../../ui/ledger/LedgerProvider';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.dashboard.title">
      <LedgerProvider>
        <DashboardScreen />
      </LedgerProvider>
    </RequireUnlocked>
  );
}
