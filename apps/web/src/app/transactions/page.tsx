'use client';

import { Suspense } from 'react';
import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { TransactionsScreen } from '../../ui/transactions/TransactionsScreen';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.transactions.title">
      <Suspense fallback={null}>
        <TransactionsScreen />
      </Suspense>
    </RequireUnlocked>
  );
}
