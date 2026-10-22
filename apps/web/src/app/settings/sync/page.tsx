'use client';

import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { SyncAndDevices } from '../../../ui/settings/SyncAndDevices';

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.sync">
      <SyncAndDevices />
    </RequireUnlocked>
  );
}
