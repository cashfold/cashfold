'use client';

import type { DesktopBridge, UpdateState } from '@cashfold/platform';
import { useEffect, useState } from 'react';
import { isDesktopApp } from '../../adapters/platform/detect';

/**
 * The desktop bridge (undefined in the web app, and until the page has hydrated) and the live state of the update flow.
 * The checking wrapper (and the schema library it needs) is loaded only inside the desktop app: the shell mounts this on every page, and the
 * web app must not pay for code it never runs (the initial bundle has a budget).
 */
export function useDesktopUpdates(): { readonly bridge: DesktopBridge | undefined; readonly state: UpdateState; readonly setState: (state: UpdateState) => void } {
  const [bridge, setBridge] = useState<DesktopBridge | undefined>();
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });

  useEffect(() => {
    if (!isDesktopApp()) return;
    let live = true;
    let stop: (() => void) | undefined;
    void import('../../adapters/platform').then(({ getDesktopBridge }) => {
      const found = getDesktopBridge();
      if (!live || found === undefined) return;
      setBridge(found);
      void found.updates.state().then((s) => live && setState(s));
      stop = found.updates.onChange((s) => live && setState(s));
    });
    return () => {
      live = false;
      stop?.();
    };
  }, []);

  return { bridge, state, setState };
}
