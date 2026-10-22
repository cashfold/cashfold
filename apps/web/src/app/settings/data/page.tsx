'use client';

import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { DataAndStorage } from '../../../ui/settings/DataAndStorage';

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.data">
      <DataAndStorage />
    </RequireUnlocked>
  );
}
