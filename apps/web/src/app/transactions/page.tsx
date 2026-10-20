'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { TransactionsScreen } from '../../ui/ledger/TransactionsScreen';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.transactions.title">
      <TransactionsScreen />
    </RequireUnlocked>
  );
}
