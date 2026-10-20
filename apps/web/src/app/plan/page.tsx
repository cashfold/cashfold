'use client';

import { Suspense } from 'react';
import { RequireUnlocked } from '../../ui/core/RequireUnlocked';
import { PlanScreen } from '../../ui/plan/PlanScreen';

export default function Screen() {
  return (
    <RequireUnlocked titleKey="page.plan.title">
      <Suspense fallback={null}>
        <PlanScreen />
      </Suspense>
    </RequireUnlocked>
  );
}
