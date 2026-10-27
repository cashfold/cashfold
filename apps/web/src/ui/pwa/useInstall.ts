'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useDesktop } from '../desktop/useDesktop';
import { isInstalledWindow } from './display-mode';
import { installStateOf, stepsFor, UNKNOWN_WAIT_MS, type InstallState, type StepsKind } from './install-state';
import type { CaptureSnapshot } from './install-capture';
import { pageCapture } from './page-capture';

const NOTHING: CaptureSnapshot = { promptEvent: false, installedInTab: false };
const subscribe = (listener: () => void) => pageCapture?.subscribe(listener) ?? (() => undefined);
const snapshot = () => pageCapture?.getSnapshot() ?? NOTHING;

/** What the install section needs: the state, and a function that shows the browser's install prompt when a person presses Install. */
export function useInstall(): { readonly state: InstallState; install(): Promise<'accepted' | 'dismissed' | 'unavailable'> } {
  const { isDesktop } = useDesktop();
  const captured = useSyncExternalStore(subscribe, snapshot, () => NOTHING);
  // Read after mount, so the first client render matches the prerendered page.
  const [installedWindow, setInstalledWindow] = useState(false);
  const [steps, setSteps] = useState<StepsKind | undefined>();
  const [waitedMs, setWaitedMs] = useState(0);

  useEffect(() => {
    setInstalledWindow(isInstalledWindow());
    setSteps(stepsFor({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }));
    const query = window.matchMedia?.('(display-mode: standalone)');
    const change = () => setInstalledWindow(isInstalledWindow());
    query?.addEventListener('change', change);
    const timer = setTimeout(() => setWaitedMs(UNKNOWN_WAIT_MS), UNKNOWN_WAIT_MS);
    return () => {
      query?.removeEventListener('change', change);
      clearTimeout(timer);
    };
  }, []);

  const install = useCallback(async () => (await pageCapture?.prompt()) ?? 'unavailable', []);
  return { state: installStateOf({ desktopApp: isDesktop, installedWindow, installedInTab: captured.installedInTab, promptEvent: captured.promptEvent, waitedMs, steps }), install };
}
