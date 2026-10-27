import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '@cashfold/platform';
import { createFrame, FRAME_BAR_HEIGHT, frameOptions, overlayColors, TRAFFIC_LIGHTS, type FrameWindowLike } from './frame';

describe('the window options', () => {
  it('put the traffic lights inside the bar on macOS', () => {
    const { options, translucent } = frameOptions({ platform: 'darwin', translucency: 'unavailable', dark: false });
    expect(options).toEqual({ titleBarStyle: 'hidden', trafficLightPosition: TRAFFIC_LIGHTS });
    expect(translucent).toBe(false);
  });

  it('draw the minimise, maximise and close buttons in the app colours, at the bar height, on Windows', () => {
    const light = frameOptions({ platform: 'win32', translucency: 'unavailable', dark: false }).options;
    const dark = frameOptions({ platform: 'win32', translucency: 'unavailable', dark: true }).options;
    expect(light).toMatchObject({ titleBarStyle: 'hidden', titleBarOverlay: { color: '#ffffff', symbolColor: '#09090b', height: FRAME_BAR_HEIGHT } });
    expect(dark).toMatchObject({ titleBarOverlay: { color: '#09090b', symbolColor: '#fafafa', height: FRAME_BAR_HEIGHT } });
  });

  it('keep the system frame on Linux', () => {
    expect(frameOptions({ platform: 'linux', translucency: 'active', dark: true })).toEqual({ options: {}, translucent: false });
  });

  it('ask for vibrancy on macOS and Mica on Windows only when translucency is active', () => {
    expect(frameOptions({ platform: 'darwin', translucency: 'active', dark: false })).toMatchObject({ options: { vibrancy: 'sidebar', visualEffectState: 'followWindow' }, translucent: true });
    expect(frameOptions({ platform: 'win32', translucency: 'active', dark: false })).toMatchObject({ options: { backgroundMaterial: 'mica' }, translucent: true });
    for (const translucency of ['unavailable', 'reduced'] as const) {
      for (const platform of ['darwin', 'win32'] as const) {
        const { options, translucent } = frameOptions({ platform, translucency, dark: false });
        expect(options).not.toHaveProperty('vibrancy');
        expect(options).not.toHaveProperty('backgroundMaterial');
        expect(translucent).toBe(false);
      }
    }
  });

  it('use the colours of the page: the overlay is the page background and text of each theme', () => {
    const css = readFileSync(join(__dirname, '..', '..', '..', 'web', 'src', 'app', 'tokens.css'), 'utf8');
    const value = (theme: string, name: string) => new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{[^}]*?${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();
    for (const theme of ['light', 'dark'] as const) {
      expect(overlayColors(theme === 'dark').color).toBe(value(theme, '--bg'));
      expect(overlayColors(theme === 'dark').symbolColor).toBe(value(theme, '--text'));
    }
  });

  it('use the same bar height as the page', () => {
    const css = readFileSync(join(__dirname, '..', '..', '..', 'web', 'src', 'app', 'globals.css'), 'utf8');
    expect(new RegExp(`--frame-bar-h:\\s*${FRAME_BAR_HEIGHT}px`).test(css)).toBe(true);
  });
});

function fakeWindow() {
  const listeners = new Map<string, () => void>();
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const win = {
    on: vi.fn((event: string, listener: () => void) => void listeners.set(event, listener)),
    isFullScreen: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    setTitleBarOverlay: vi.fn(),
    setVibrancy: vi.fn(),
    setBackgroundMaterial: vi.fn(),
    webContents: { send: (channel: string, payload: unknown) => void sent.push({ channel, payload }) },
  };
  return { win: win as unknown as FrameWindowLike & typeof win, listeners, sent };
}

function setup(platform: NodeJS.Platform, initial: { translucency?: 'active' | 'reduced' | 'unavailable'; dark?: boolean } = {}) {
  const state = { translucency: initial.translucency ?? 'active', dark: initial.dark ?? false };
  const setTransparent = vi.fn();
  const frame = createFrame({ platform, translucency: () => state.translucency, isDark: () => state.dark, setTransparent });
  const { win, listeners, sent } = fakeWindow();
  return { frame, state, setTransparent, win, listeners, sent };
}

describe('keeping the frame right', () => {
  it('makes the window transparent when a material was asked for, and not otherwise', () => {
    const on = setup('darwin');
    on.frame.options();
    expect(on.setTransparent).toHaveBeenLastCalledWith(true);
    const off = setup('darwin', { translucency: 'unavailable' });
    off.frame.options();
    expect(off.setTransparent).toHaveBeenLastCalledWith(false);
  });

  it('tells the page the state when attached, and on full screen and maximise', () => {
    const { frame, win, listeners, sent } = setup('darwin');
    frame.options();
    frame.attach(win);
    expect(sent.at(-1)).toEqual({ channel: CHANNELS.frameState, payload: { fullscreen: false, maximized: false, translucent: true } });
    win.isFullScreen.mockReturnValue(true);
    listeners.get('enter-full-screen')!();
    expect(sent.at(-1)!.payload).toEqual({ fullscreen: true, maximized: false, translucent: true });
    win.isFullScreen.mockReturnValue(false);
    win.isMaximized.mockReturnValue(true);
    listeners.get('maximize')!();
    expect(sent.at(-1)!.payload).toEqual({ fullscreen: false, maximized: true, translucent: true });
    listeners.get('unmaximize')!();
    listeners.get('leave-full-screen')!();
    expect(sent.length).toBeGreaterThanOrEqual(5);
  });

  it('turns the material off at once when the person asks for reduced transparency or high contrast, and on again after', () => {
    const { frame, state, win, setTransparent, sent } = setup('darwin');
    frame.options();
    frame.attach(win);
    state.translucency = 'reduced';
    frame.refresh();
    expect(win.setVibrancy).toHaveBeenLastCalledWith(null);
    expect(setTransparent).toHaveBeenLastCalledWith(false);
    expect(sent.at(-1)!.payload).toMatchObject({ translucent: false });
    state.translucency = 'active';
    frame.refresh();
    expect(win.setVibrancy).toHaveBeenLastCalledWith('sidebar');
    expect(sent.at(-1)!.payload).toMatchObject({ translucent: true });
  });

  it('switches Mica the same way on Windows, and recolours the window buttons with the theme', () => {
    const { frame, state, win } = setup('win32');
    frame.options();
    frame.attach(win);
    state.dark = true;
    state.translucency = 'reduced';
    frame.refresh();
    expect(win.setBackgroundMaterial).toHaveBeenLastCalledWith('none');
    expect(win.setTitleBarOverlay).toHaveBeenLastCalledWith({ color: '#09090b', symbolColor: '#fafafa', height: FRAME_BAR_HEIGHT });
  });

  it('does nothing to the system frame on Linux', () => {
    const { frame, win } = setup('linux');
    frame.options();
    frame.attach(win);
    frame.refresh();
    expect(win.setTitleBarOverlay).not.toHaveBeenCalled();
    expect(win.setVibrancy).not.toHaveBeenCalled();
    expect(win.setBackgroundMaterial).not.toHaveBeenCalled();
  });

  it('leaves a window that is gone alone', () => {
    const { frame, win, sent } = setup('win32');
    frame.attach(win);
    const before = sent.length;
    win.isDestroyed.mockReturnValue(true);
    expect(() => frame.refresh()).not.toThrow();
    expect(sent.length).toBe(before);
  });
});
