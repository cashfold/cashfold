'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { SettingsIndex } from '../../ui/settings/SettingsIndex';

export default function SettingsPage() {
  return (
    <RequireUnlocked titleKey="page.settings.title">
      <SettingsIndex />
    </RequireUnlocked>
  );
}
