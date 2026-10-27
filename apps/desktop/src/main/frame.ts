import { CHANNELS, type Capabilities, type FrameState } from '@cashfold/platform';
import type { BrowserWindowConstructorOptions } from 'electron';

// The window frame (spec 006, US7, research D11): on macOS and Windows the title bar is a slim bar of the app's own window, with the system's window
// buttons inside it; on Linux the system's own title bar is kept (a custom one is wrong on too many desktops). Where the system offers a translucent
// material (macOS vibrancy, Windows 11 Mica) the sidebar can use it, and it is switched off live when the person asks for reduced transparency or high
// contrast.

/** The height of the bar, in pixels. The web app's CSS (`--frame-bar-h` in globals.css) holds the same number; frame.test.ts checks that they agree. */
export const FRAME_BAR_HEIGHT = 40;
/** Where the traffic lights sit inside the bar on macOS (the page keeps 80 px clear at the start of the bar). */
export const TRAFFIC_LIGHTS = { x: 16, y: 14 } as const;

// The window controls the shell draws on Windows: the colours of the bar (the page's --bg and --text of each theme).
const OVERLAY = {
  light: { color: '#ffffff', symbolColor: '#09090b' },
  dark: { color: '#09090b', symbolColor: '#fafafa' },
} as const;

export const overlayColors = (dark: boolean): { color: string; symbolColor: string } => ({ ...(dark ? OVERLAY.dark : OVERLAY.light) });

export interface FrameFacts {
  readonly platform: NodeJS.Platform;
  readonly translucency: Capabilities['translucency'];
  readonly dark: boolean;
}

/** The options a window is created with. `translucent` says whether a material was asked for (so the window must have no colour of its own). */
export function frameOptions(facts: FrameFacts): { options: BrowserWindowConstructorOptions; translucent: boolean } {
  const translucent = facts.translucency === 'active';
  if (facts.platform === 'darwin') {
    return {
      options: { titleBarStyle: 'hidden', trafficLightPosition: { ...TRAFFIC_LIGHTS }, ...(translucent ? { vibrancy: 'sidebar', visualEffectState: 'followWindow' } : {}) },
      translucent,
    };
  }
  if (facts.platform === 'win32') {
    return {
      options: { titleBarStyle: 'hidden', titleBarOverlay: { ...overlayColors(facts.dark), height: FRAME_BAR_HEIGHT }, ...(translucent ? { backgroundMaterial: 'mica' } : {}) },
      translucent,
    };
  }
  return { options: {}, translucent: false };
}

export interface FrameWindowLike {
  on(event: 'enter-full-screen' | 'leave-full-screen' | 'maximize' | 'unmaximize', listener: () => void): unknown;
  isFullScreen(): boolean;
  isMaximized(): boolean;
  isDestroyed(): boolean;
  setTitleBarOverlay(options: { color: string; symbolColor: string; height: number }): void;
  setVibrancy(type: 'sidebar' | null, options?: { animationDuration?: number }): void;
  setBackgroundMaterial(material: 'mica' | 'none'): void;
  readonly webContents: { send(channel: string, payload: FrameState): void };
}

export interface FrameDeps {
  readonly platform: NodeJS.Platform;
  /** The live capability report: translucency changes with the system's transparency and contrast settings. */
  readonly translucency: () => Capabilities['translucency'];
  readonly isDark: () => boolean;
  /** Tells the colour logic to leave the window transparent (or not). */
  readonly setTransparent: (on: boolean) => void;
}

export interface Frame {
  /** The options for a new window. */
  options(): BrowserWindowConstructorOptions;
  /** Keeps the frame right for this window: reports its state, recolours the controls, switches the material. Call `refresh` after a theme or system change. */
  attach(win: FrameWindowLike): void;
  refresh(): void;
  /** What the page is told: full screen, maximised, and whether the translucent material is on. */
  state(win: FrameWindowLike): FrameState;
}

export function createFrame(deps: FrameDeps): Frame {
  let window: FrameWindowLike | undefined;
  let translucent = false;

  const facts = (): FrameFacts => ({ platform: deps.platform, translucency: deps.translucency(), dark: deps.isDark() });
  const state = (win: FrameWindowLike): FrameState => ({ fullscreen: win.isFullScreen(), maximized: win.isMaximized(), translucent });
  const send = (): void => {
    if (window !== undefined && !window.isDestroyed()) window.webContents.send(CHANNELS.frameState, state(window));
  };

  const refresh = (): void => {
    if (window === undefined || window.isDestroyed()) return;
    const now = facts();
    const wanted = frameOptions(now).translucent;
    if (deps.platform === 'win32') window.setTitleBarOverlay({ ...overlayColors(now.dark), height: FRAME_BAR_HEIGHT });
    if (wanted !== translucent) {
      translucent = wanted;
      if (deps.platform === 'darwin') window.setVibrancy(wanted ? 'sidebar' : null);
      if (deps.platform === 'win32') window.setBackgroundMaterial(wanted ? 'mica' : 'none');
      deps.setTransparent(wanted);
    }
    send();
  };

  return {
    options() {
      const made = frameOptions(facts());
      translucent = made.translucent;
      deps.setTransparent(translucent);
      return made.options;
    },
    attach(win) {
      window = win;
      for (const event of ['enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize'] as const) win.on(event, send);
      refresh();
    },
    refresh,
    state,
  };
}
