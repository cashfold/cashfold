'use client';

import type { Capabilities, DesktopBridge, DesktopSettings, SettingsUpdate } from '@cashfold/platform';
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { findRawBridge, isDesktopApp } from '../../adapters/platform/detect';
import { createDesktopStore, INERT, type DesktopPlatform, type DesktopStore } from './desktop-store';

export interface DesktopApi {
  readonly isDesktop: boolean;
  readonly platform: DesktopPlatform | undefined;
  readonly settings: DesktopSettings;
  readonly capabilities: Capabilities | undefined;
  readonly ready: boolean;
  /** Stores a preference. Resolves with whether start at login could be applied, or undefined if the shell did not answer. */
  update(change: SettingsUpdate): Promise<{ readonly startAtLogin: boolean } | undefined>;
  /** The checking bridge, once loaded; undefined in a browser. */
  bridge(): DesktopBridge | undefined;
}

const platformOf = (): DesktopPlatform | undefined => {
  const value = (findRawBridge() as { platform?: unknown } | undefined)?.platform;
  return value === 'win32' || value === 'darwin' || value === 'linux' ? value : undefined;
};

/** One store for the page, created on first use: the check itself needs no schema code, the wrapper is loaded only in the desktop app. */
let shared: DesktopStore | undefined;
const sharedStore = (): DesktopStore =>
  (shared ??= createDesktopStore({
    isDesktop: () => isDesktopApp(),
    platform: platformOf,
    loadBridge: async () => (await import('../../adapters/platform')).getDesktopBridge(),
  }));

const DesktopContext = createContext<DesktopApi | undefined>(undefined);

/** Sits above the Core provider so the lock policy can read the preferences. Reads only the synchronous check at start. */
export function DesktopSettingsProvider({ children, store = sharedStore() }: { children: ReactNode; store?: DesktopStore }) {
  const info = useSyncExternalStore(store.subscribe, store.getSnapshot, () => INERT);
  useEffect(() => store.start(), [store]);
  const api = useMemo<DesktopApi>(() => ({ ...info, update: (change) => store.update(change), bridge: () => store.bridge() }), [info, store]);
  return <DesktopContext.Provider value={api}>{children}</DesktopContext.Provider>;
}

const OUTSIDE: DesktopApi = { ...INERT, update: async () => undefined, bridge: () => undefined };

/** Outside a provider (a unit test, a story) everything is the inert default. */
export function useDesktop(): DesktopApi {
  return useContext(DesktopContext) ?? OUTSIDE;
}
