import type { NativeImage } from 'electron';
import { PRIMARY_COLORS } from '@cashfold/platform';

// The app icon in the running app follows the person's primary colour (spec 014): the dock icon on macOS, the window and taskbar icon on Windows and
// Linux. The page tells the shell a palette id; the images are the ones packed in `build/icons`, so no path or image crosses the bridge. The
// icon the system shows for the app when it is not running, and in the installer, cannot change.

const isPrimaryColor = (value: unknown): value is (typeof PRIMARY_COLORS)[number] => PRIMARY_COLORS.includes(value as never);

export interface AppIconDeps {
  readonly platform: NodeJS.Platform;
  /** `app.dock.setIcon` (macOS). */
  readonly setDockIcon: (image: NativeImage) => void;
  /** Sets the icon of every open window (Windows, Linux). */
  readonly setWindowIcons: (image: NativeImage) => void;
  /** The image for a palette id, read from inside the package. */
  readonly image: (id: string) => NativeImage;
}

export interface AppIcon {
  /** Shows the icon of a colour; anything that is not a palette id is ignored. Never throws. */
  set(primary: unknown): void;
  /** The colour shown now, for a window created after it was set. */
  current(): string | undefined;
}

export function createAppIcon(deps: AppIconDeps): AppIcon {
  let current: string | undefined;
  return {
    set(primary) {
      if (!isPrimaryColor(primary) || primary === current) return;
      try {
        const image = deps.image(primary);
        if (deps.platform === 'darwin') deps.setDockIcon(image);
        else deps.setWindowIcons(image);
        current = primary;
      } catch {
        // The icon is best effort; the app works with the one it has.
      }
    },
    current: () => current,
  };
}
