'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { CategoriesScreen } from '../../ui/ledger/CategoriesScreen';
import { LedgerProvider } from '../../ui/ledger/LedgerProvider';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.categories.title">
      <LedgerProvider>
        <CategoriesScreen />
      </LedgerProvider>
    </RequireUnlocked>
  );
}
