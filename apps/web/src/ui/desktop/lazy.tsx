'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { isDesktopApp } from '../../adapters/platform/detect';

// Everything that exists only for the desktop app is loaded by a dynamic import() that runs only when the page is inside the desktop app, the
// same way useDesktopUpdates loads the checking wrapper. The web app's first download therefore does not grow, and a browser never runs any of it.

/** Runs `load` (a dynamic import) in the desktop app; resolves to undefined, without loading anything, anywhere else. */
export async function loadDesktop<T>(load: () => Promise<T>, host: object = globalThis): Promise<T | undefined> {
  return isDesktopApp(host) ? load() : undefined;
}

/** Renders a desktop-only component, loaded on demand: `<DesktopOnly load={() => import('./Thing')} />` (the module's default export). */
export function DesktopOnly({ load }: { load: () => Promise<{ default: ComponentType }> }) {
  const [Loaded, setLoaded] = useState<ComponentType | undefined>();
  useEffect(() => {
    let live = true;
    loadDesktop(load)
      .then((module) => {
        if (live && module !== undefined) setLoaded(() => module.default);
      })
      // A part that fails to load leaves the app as it was; the desktop extras are never required.
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // The loader is a constant arrow at the call site; loading again on every render would be wrong.
  }, []);
  return Loaded === undefined ? null : <Loaded />;
}
