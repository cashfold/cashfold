'use client';

import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { FoldsScreen } from '../../ui/folds/FoldsScreen';

export default function FoldsPage() {
  return (
    <RequireUnlocked titleKey="page.folds.title">
      <FoldsScreen />
    </RequireUnlocked>
  );
}
