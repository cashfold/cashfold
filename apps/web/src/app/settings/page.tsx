'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { SettingsScreen } from '../../ui/settings/SettingsScreen';

export default function SettingsPage() {
  return (
    <RequireUnlocked titleKey="page.settings.title">
      <SettingsScreen />
    </RequireUnlocked>
  );
}
