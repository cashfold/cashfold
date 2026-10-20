'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { AccountsScreen } from '../../ui/ledger/AccountsScreen';
import { LedgerProvider } from '../../ui/ledger/LedgerProvider';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.accounts.title">
      <LedgerProvider>
        <AccountsScreen />
      </LedgerProvider>
    </RequireUnlocked>
  );
}
