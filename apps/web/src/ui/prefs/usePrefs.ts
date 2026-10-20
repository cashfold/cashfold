'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { createPrefsStore, type PrefsStore } from './store';
import { DEFAULT_PREFS, type Prefs } from './schema';

/** The app's store, over window.localStorage (absent while the page is prerendered). */
export const prefsStore: PrefsStore = createPrefsStore(() => (typeof window === 'undefined' ? undefined : window.localStorage));

/** Reads one slice of the preferences; re-renders only when the selected value changes. */
export function usePrefs<T>(select: (prefs: Prefs) => T): T {
  // The server snapshot is the defaults, so the first client render matches the prerendered HTML.
  const get = useCallback(() => select(prefsStore.get()), [select]);
  return useSyncExternalStore(prefsStore.subscribe, get, () => select(DEFAULT_PREFS));
}

export function useSetPrefs(): (change: (prev: Prefs) => Prefs) => void {
  return prefsStore.update.bind(prefsStore);
}
