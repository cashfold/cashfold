// "Keep running": closing the window hides it instead of destroying it, so the page and its session stay alive (and with them the idle timer
// and the reminder service) until the person's idle time locks the app or they choose Quit. Off, closing behaves as it always has.

export interface BackgroundWindowLike {
  hide(): void;
  show(): void;
  focus(): void;
  isMinimized(): boolean;
  restore(): void;
  isDestroyed(): boolean;
}

export interface CloseEventLike {
  preventDefault(): void;
}

export interface BackgroundMode {
  /** Quit was chosen (or the system is quitting the app): from now on closing really closes. */
  markQuitting(): void;
  isQuitting(): boolean;
  /** True when closing the window should hide it. */
  keepsRunning(): boolean;
  /** Call from the window's `close` event. Returns true when the close was turned into a hide. */
  handleClose(event: CloseEventLike, window: BackgroundWindowLike): boolean;
  /** Whether the app should quit now that no window is open. */
  quitWhenAllClosed(platform: NodeJS.Platform): boolean;
  /** Brings an existing window back (tray, dock, second launch). Returns false when there is none to bring back. */
  reveal(window: BackgroundWindowLike | undefined): boolean;
}

export function createBackgroundMode({ enabled }: { enabled: () => boolean }): BackgroundMode {
  let quitting = false;
  const keepsRunning = (): boolean => enabled() && !quitting;
  return {
    markQuitting: () => {
      quitting = true;
    },
    isQuitting: () => quitting,
    keepsRunning,
    handleClose(event, window) {
      if (!keepsRunning()) return false;
      event.preventDefault();
      window.hide();
      return true;
    },
    quitWhenAllClosed: (platform) => platform !== 'darwin' && !keepsRunning(),
    reveal(window) {
      if (window === undefined || window.isDestroyed()) return false;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return true;
    },
  };
}
