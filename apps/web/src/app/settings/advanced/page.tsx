'use client';

import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { Advanced } from '../../../ui/settings/Advanced';

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.advanced">
      <Advanced />
    </RequireUnlocked>
  );
}
