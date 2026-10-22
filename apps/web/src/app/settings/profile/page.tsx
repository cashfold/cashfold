'use client';

import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { ProfileSecurity } from '../../../ui/settings/ProfileSecurity';

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.profile">
      <ProfileSecurity />
    </RequireUnlocked>
  );
}
