'use client';

import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { AppearanceSection } from '../../../ui/settings/AppearanceSection';

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.appearance">
      <AppearanceSection />
    </RequireUnlocked>
  );
}
