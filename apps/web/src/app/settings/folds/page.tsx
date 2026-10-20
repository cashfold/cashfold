'use client';

import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { FoldsScreen } from '../../../ui/folds/FoldsScreen';

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.folds">
      <FoldsScreen />
    </RequireUnlocked>
  );
}
