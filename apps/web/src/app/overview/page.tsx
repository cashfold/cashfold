'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { DashboardScreen } from '../../ui/ledger/DashboardScreen';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.overview.title">
      <DashboardScreen />
    </RequireUnlocked>
  );
}
