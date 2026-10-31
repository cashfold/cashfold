'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import { isRevealed, subscribe } from './reveal-store';

// What the rest of the app asks of Privacy mode (contracts/ui-contract.md §2). With no provider (the sign-in screens, tests) the mode is off and nothing
// is masked, so a component can always call this.

export interface PrivacyApi {
  /** The preference: whether money amounts are masked on screen. */
  readonly on: boolean;
  /** Flips the mode and hides every revealed amount. */
  toggle(): void;
  /** Shows one amount for a few seconds. */
  reveal(id: string): void;
}

const OFF: PrivacyApi = { on: false, toggle: () => undefined, reveal: () => undefined };

export const PrivacyContext = createContext<PrivacyApi>(OFF);

export const usePrivacy = (): PrivacyApi => useContext(PrivacyContext);

/** Whether this one amount is shown now. Only the amount that changes re-renders. */
export function useRevealed(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isRevealed(id),
    () => false,
  );
}
