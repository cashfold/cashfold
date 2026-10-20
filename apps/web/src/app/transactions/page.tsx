'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { TransactionsScreen } from '../../ui/ledger/TransactionsScreen';
import { LedgerProvider } from '../../ui/ledger/LedgerProvider';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.transactions.title">
      <LedgerProvider>
        <TransactionsScreen />
      </LedgerProvider>
    </RequireUnlocked>
  );
}
