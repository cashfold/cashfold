'use client';

import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { SettingsScreen } from '../../../ui/settings/SettingsScreen';

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.profile">
      <SettingsScreen />
    </RequireUnlocked>
  );
}
