'use client';

import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { SettingsPlaceholder } from '../../../ui/settings/SettingsPlaceholder';

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.appearance">
      <SettingsPlaceholder titleKey="settings.group.appearance" />
    </RequireUnlocked>
  );
}
