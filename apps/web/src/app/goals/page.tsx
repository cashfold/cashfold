'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { GoalsScreen } from '../../ui/goals/GoalsScreen';
import { LedgerProvider } from '../../ui/ledger/LedgerProvider';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.goals.title">
      <LedgerProvider>
        <GoalsScreen />
      </LedgerProvider>
    </RequireUnlocked>
  );
}
