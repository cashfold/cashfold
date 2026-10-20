'use client';

import { DevicesScreen } from '../../ui/devices/DevicesScreen';
import { RequireUnlocked } from '../../ui/core/RequireUnlocked';

export default function DevicesPage() {
  return (
    <RequireUnlocked titleKey="page.devices.title">
      <DevicesScreen />
    </RequireUnlocked>
  );
}
