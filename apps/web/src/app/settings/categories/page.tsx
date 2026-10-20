'use client';

import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { CategoriesScreen } from '../../../ui/ledger/CategoriesScreen';

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.categories">
      <CategoriesScreen />
    </RequireUnlocked>
  );
}
