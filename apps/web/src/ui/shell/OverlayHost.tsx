'use client';

import { useEffect, type ReactNode } from 'react';
import { useCore } from '../core/CoreProvider';

// Overlays (the add sheet, dialogs, menus) live in the layer Headless UI creates at the end of <body>. While the privacy cover shows, that layer
// must be unreachable like the page behind it, yet stay mounted so what was typed survives (R-UX-10). On lock the signed-in shell unmounts, which
// closes every overlay and discards its state without an unsaved-changes prompt.
export const PORTAL_ROOT_ID = 'headlessui-portal-root';

interface Coverable {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export function coverPortals(root: Coverable | null, covered: boolean): void {
  if (root === null) return;
  if (covered) {
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
  } else {
    root.removeAttribute('inert');
    root.removeAttribute('aria-hidden');
  }
}

export function OverlayHost({ children }: { children: ReactNode }) {
  const { covered } = useCore();
  useEffect(() => {
    const apply = () => coverPortals(document.getElementById(PORTAL_ROOT_ID), covered);
    apply();
    if (!covered) return;
    // The layer is created when the first overlay opens: catch one that appears while covered.
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [covered]);
  // The page itself is made inert by the shell (its content area) and hidden by the opaque cover; this layer only has to hold the overlays.
  return <>{children}</>;
}
