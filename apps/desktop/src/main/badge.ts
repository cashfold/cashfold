import type { NativeImage } from 'electron';
import type { ShellLabels } from './menu-labels';

// The count of scheduled entries waiting for the person, shown on the dock icon (macOS) or the taskbar button (Windows) while the app is unlocked,
// and nothing otherwise. The page computes it and tells the shell; the shell keeps it only in memory and clears it itself on a system lock and on
// quit, so a stuck page cannot leave a count behind (spec 006, FR-016, clarification 1).

export const MAX_BADGE = 999;

/** A whole number from 0 to 999; anything else is 0. */
export const clampCount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_BADGE, Math.max(0, Math.trunc(value))) : 0);

/** The image for a count on Windows, which has no count API: a ready-made overlay for 1 to 9, and "9+" beyond. */
export const overlayImageName = (count: number): string => (count > 9 ? '9plus' : String(count));

export interface BadgeDeps {
  readonly platform: NodeJS.Platform;
  /** `app.setBadgeCount` (macOS). */
  readonly setBadgeCount: (count: number) => void;
  /** The taskbar overlay of the window (Windows); null removes it. A no-op when there is no window yet. */
  readonly setOverlay: (image: NativeImage | null, description: string) => void;
  readonly image: (name: string) => NativeImage;
  readonly labels: () => ShellLabels;
}

export interface Badge {
  set(count: unknown): void;
  clear(): void;
  /** Shows the current count again, for a window created after it was set. */
  reapply(): void;
  current(): number;
}

export function createBadge(deps: BadgeDeps): Badge {
  let count = 0;
  const show = (): void => {
    if (deps.platform === 'darwin') deps.setBadgeCount(count);
    else if (deps.platform === 'win32') {
      if (count === 0) deps.setOverlay(null, '');
      else deps.setOverlay(deps.image(overlayImageName(count)), deps.labels().badgeDescription(count));
    }
  };
  return {
    set(next) {
      count = clampCount(next);
      show();
    },
    clear() {
      count = 0;
      show();
    },
    reapply: show,
    current: () => count,
  };
}
