import type { Capabilities, DesktopBridge, DesktopSettings, SettingsUpdate } from '@cashfold/platform';

// What the page knows about the desktop shell: whether there is one, which system it runs on, the person's desktop preferences and what this
// computer can do. In a browser every value is the inert default and nothing here ever calls the bridge.

export type DesktopPlatform = 'win32' | 'darwin' | 'linux';

export interface DesktopInfo {
  readonly isDesktop: boolean;
  readonly platform: DesktopPlatform | undefined;
  readonly settings: DesktopSettings;
  readonly capabilities: Capabilities | undefined;
  /** True once the shell has answered (or failed to): until then the defaults apply. */
  readonly ready: boolean;
}

export const INERT_SETTINGS: DesktopSettings = { hideOnBlur: false, startAtLogin: false, closeBehavior: 'quit', theme: 'system' };
export const INERT: DesktopInfo = { isDesktop: false, platform: undefined, settings: INERT_SETTINGS, capabilities: undefined, ready: false };

export interface DesktopStoreDeps {
  /** The synchronous shape check: no schema code is loaded to answer it. */
  readonly isDesktop: () => boolean;
  readonly platform: () => DesktopPlatform | undefined;
  /** Loads the checking wrapper; only called in the desktop app. */
  readonly loadBridge: () => Promise<DesktopBridge | undefined>;
}

export interface DesktopStore {
  getSnapshot(): DesktopInfo;
  subscribe(listener: () => void): () => void;
  /** Reads the shell's settings once; safe to call again. */
  start(): void;
  /** Changes a preference; the answer from the shell is what is kept. Returns whether the start-at-login choice could be applied. */
  update(change: SettingsUpdate): Promise<{ readonly startAtLogin: boolean } | undefined>;
  /** The bridge, once loaded (for the other desktop-only parts of the page). */
  bridge(): DesktopBridge | undefined;
}

export function createDesktopStore(deps: DesktopStoreDeps): DesktopStore {
  let snapshot: DesktopInfo = INERT;
  let bridge: DesktopBridge | undefined;
  let started = false;
  const listeners = new Set<() => void>();
  const set = (next: DesktopInfo): void => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    bridge: () => bridge,
    start() {
      if (started || !deps.isDesktop()) return;
      started = true;
      set({ ...snapshot, isDesktop: true, platform: deps.platform() });
      void deps
        .loadBridge()
        .then(async (loaded) => {
          if (loaded === undefined) throw new Error('no bridge');
          bridge = loaded;
          loaded.onSettingsChanged((settings) => set({ ...snapshot, settings }));
          const { settings, capabilities } = await loaded.settings.get();
          set({ ...snapshot, settings, capabilities, ready: true });
        })
        // A shell that cannot answer leaves the defaults in place; the page works either way.
        .catch(() => set({ ...snapshot, ready: true }));
    },
    async update(change) {
      if (bridge === undefined) return undefined;
      try {
        const answer = await bridge.settings.set(change);
        set({ ...snapshot, settings: answer.settings });
        return answer.applied;
      } catch {
        return undefined;
      }
    },
  };
}
