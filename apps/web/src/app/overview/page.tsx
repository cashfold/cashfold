'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { OverviewScreen } from '../../ui/overview/OverviewScreen';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.overview.title">
      <OverviewScreen />
    </RequireUnlocked>
  );
}
