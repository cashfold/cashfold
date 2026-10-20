'use client';

import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { DataScreen } from '../../../ui/data/DataScreen';

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.data">
      <DataScreen />
    </RequireUnlocked>
  );
}
