'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { AccountsScreen } from '../../ui/ledger/AccountsScreen';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.accounts.title">
      <AccountsScreen />
    </RequireUnlocked>
  );
}
