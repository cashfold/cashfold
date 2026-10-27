'use client';

import { useEffect } from 'react';

// "Take me to the search field" and "to the import panel" come from a shortcut, which also changes the screen: the target may not exist yet. So the
// request is held until the screen that owns the target mounts (or is already there) and asks for it. Held in memory only.

export type FocusTarget = 'transactions-search' | 'data-import' | 'data-export';

let pending: FocusTarget | undefined;
const listeners = new Set<() => void>();

export const focusRequests = {
  request(target: FocusTarget): void {
    pending = target;
    listeners.forEach((listener) => listener());
  },
  /** True once, if `target` is the pending request. */
  take(target: FocusTarget): boolean {
    if (pending !== target) return false;
    pending = undefined;
    return true;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** In the screen that owns `target`: runs `focus` when it is requested, including a request made before the screen was on screen. */
export function useFocusRequest(target: FocusTarget, focus: () => void): void {
  useEffect(() => {
    const run = (): void => {
      if (focusRequests.take(target)) focus();
    };
    run();
    return focusRequests.subscribe(run);
    // `focus` reads refs only, so it is safe to leave out.
  }, [target]);
}
