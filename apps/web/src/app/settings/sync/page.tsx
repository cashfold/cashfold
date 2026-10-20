'use client';

import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { DevicesScreen } from '../../../ui/devices/DevicesScreen';

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.sync">
      <DevicesScreen />
    </RequireUnlocked>
  );
}
