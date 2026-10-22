'use client';

import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { FoldsAndSharing } from '../../../ui/settings/FoldsAndSharing';

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.folds">
      <FoldsAndSharing />
    </RequireUnlocked>
  );
}
