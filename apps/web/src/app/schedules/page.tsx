'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { LedgerProvider } from '../../ui/ledger/LedgerProvider';
import { SchedulesScreen } from '../../ui/schedules/SchedulesScreen';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.schedules.title">
      <LedgerProvider>
        <SchedulesScreen />
      </LedgerProvider>
    </RequireUnlocked>
  );
}
