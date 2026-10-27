'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { InstallSection } from '../../../ui/settings/InstallSection';
import { useInstall } from '../../../ui/pwa/useInstall';

/**
 * Installing is offered only where it can help. A typed address that leads here when it cannot (the desktop app, an installed window, a browser that cannot
 * install) goes to the Settings index. The state starts as unknown while the browser may still hand over its install event, so the page waits for it.
 */
function Gate() {
  const router = useRouter();
  const { state } = useInstall();
  const usable = state.kind === 'promptable' || state.kind === 'steps' || state.kind === 'installed-in-tab';
  useEffect(() => {
    if (state.kind === 'installed' || state.kind === 'unavailable') router.replace('/settings/');
  }, [state.kind, router]);
  return usable ? <InstallSection /> : null;
}

export default function Page() {
  return (
    <RequireUnlocked titleKey="settings.group.install">
      <Gate />
    </RequireUnlocked>
  );
}
