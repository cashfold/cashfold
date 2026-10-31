'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { getDesktopBridge } from '../../adapters/platform';
import { useCore } from '../core/CoreProvider';
import { useLedger } from '../ledger/LedgerProvider';
import { useAddSheet } from '../shell/add-context';
import { afterOverlaysLeave, dismissOverlays } from '../shell/overlay-signal';
import { recentFoldsOf } from './desktop-presence';
import { focusRequests } from './focus-request';
import { togglePalette } from '../palette/palette-bus';
import { usePrivacy } from '../privacy/usePrivacy';
import { performMenuAction } from './menu-action';

/** Carries out what the desktop shell reports: a shortcut was pressed. Mounted in the unlocked shell, only in the desktop app. */
export default function DesktopActions() {
  const core = useCore();
  const ledger = useLedger();
  const router = useRouter();
  const { openAdd } = useAddSheet();
  const privacy = usePrivacy();
  const latest = useRef({ core, router, openAdd, ledger, privacy });
  latest.current = { core, router, openAdd, ledger, privacy };

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (bridge === undefined) return;
    return bridge.onMenuAction((action) => {
      // A help dialog or drawer that is open closes first, and the action runs once it has left, so it does not run behind it.
      const run = () => performMenuAction(action, {
        togglePalette,
        togglePrivacy: () => latest.current.privacy.toggle(),
        unlocked: latest.current.core.phase === 'unlocked',
        openAdd: () => latest.current.openAdd(),
        lock: () => void latest.current.core.lock(),
        navigate: (href) => latest.current.router.push(href),
        focus: (target) => focusRequests.request(target),
        // The same list, in the same order, that DesktopPresence sent the shell for its menus.
        openFold: (index) => {
          const { ledger: l, router: r } = latest.current;
          const fold = recentFoldsOf(l.folds, l.fold?.id)[index];
          if (fold === undefined) return;
          l.selectFold(fold.id);
          r.push('/overview/');
        },
      });
      // The palette shortcut toggles the palette itself; it does not close Help or the drawer first (the palette never opens over another dialog).
      // Toggling the palette or Privacy mode needs no dialog to close first (the palette never opens over another dialog, and hiding figures changes nothing under it).
      if (action === 'palette' || action === 'privacy') run();
      else if (dismissOverlays() > 0) afterOverlaysLeave(run);
      else run();
    });
  }, []);
  return null;
}
