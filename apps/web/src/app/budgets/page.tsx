'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { BudgetsScreen } from '../../ui/budgets/BudgetsScreen';
import { LedgerProvider } from '../../ui/ledger/LedgerProvider';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.budgets.title">
      <LedgerProvider>
        <BudgetsScreen />
      </LedgerProvider>
    </RequireUnlocked>
  );
}
