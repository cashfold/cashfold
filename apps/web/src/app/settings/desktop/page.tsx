'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { isDesktopApp } from '../../../adapters/platform/detect';
import { RequireUnlocked } from '../../../ui/core/RequireUnlocked';
import { DesktopSection } from '../../../ui/settings/DesktopSection';

/** Only the desktop app has this page; a browser that arrives here (a typed address) goes to the Settings index. */
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    if (!isDesktopApp()) router.replace('/settings/');
  }, [router]);
  return (
    <RequireUnlocked titleKey="settings.group.desktop">
      <DesktopSection />
    </RequireUnlocked>
  );
}
