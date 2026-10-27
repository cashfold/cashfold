import type { PendingOccurrence } from '@cashfold/core';

// What the page tells the desktop shell about itself so the dock or taskbar count and the quick-action menus can show it: how many scheduled
// entries wait (selected Fold), and the names of up to five Folds. Both are sent only while unlocked and cleared on a lock.

export const MAX_RECENT_FOLDS = 5;
export const MAX_FOLD_NAME = 40;

export const waitingCount = (pending: readonly PendingOccurrence[]): number => Math.min(999, pending.length);

interface FoldLike {
  readonly id: string;
  readonly name: string;
}

/** Up to five Folds for the shell's menus: the selected one first, then the rest in their order; names cut to 40 characters. */
export function recentFoldsOf(folds: readonly FoldLike[], selectedId: string | undefined): Array<{ id: string; name: string }> {
  const selected = folds.find((fold) => fold.id === selectedId);
  const ordered = selected === undefined ? folds : [selected, ...folds.filter((fold) => fold !== selected)];
  return ordered.slice(0, MAX_RECENT_FOLDS).map((fold) => ({ id: fold.id.slice(0, 64), name: (fold.name.length > MAX_FOLD_NAME ? fold.name.slice(0, MAX_FOLD_NAME) : fold.name) || '·' }));
}

export interface PresenceBridge {
  setBadge(count: number): Promise<void>;
  setRecentFolds(folds: Array<{ id: string; name: string }>): Promise<void>;
}

/** Sends the count and the Folds. A shell that is missing or refuses is not an error: they are a convenience. */
export async function sendPresence(bridge: PresenceBridge | undefined, count: number, folds: Array<{ id: string; name: string }>): Promise<void> {
  if (bridge === undefined) return;
  await Promise.allSettled([bridge.setBadge(count), bridge.setRecentFolds(folds)]);
}

/** On a lock the count goes to nothing and the Fold names are forgotten. */
export const clearPresence = (bridge: PresenceBridge | undefined): Promise<void> => sendPresence(bridge, 0, []);
