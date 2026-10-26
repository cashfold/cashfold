import { join } from 'node:path';
import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import type { ShellLanguage } from '@cashfold/platform';
import { APP_NAME, APP_ORIGIN } from './identity';
import type { BackgroundMode } from './background';
import type { DesktopStateStore } from './desktop-state';
import type { Logger } from './log';
import { installNativeFeel } from './native-feel';
import { lockDownContents } from './security';
import { installShortcuts } from './shortcuts';
import { installTextMenu } from './text-menu';

export interface WindowDeps {
  readonly store: DesktopStateStore;
  readonly background: BackgroundMode;
  readonly log: Logger;
  readonly openExternal: (url: string) => Promise<void>;
  /** Only in an unpackaged run: a dev server to load instead of the packaged export. */
  readonly devUrl: string | undefined;
  /** What the page last said about its session, and the language the app is shown in. */
  readonly pageLocked: () => boolean;
  readonly language: () => ShellLanguage;
}

/** The one application window: isolated, sandboxed, with no Node in the page, restoring where it was. */
export function createMainWindow(deps: WindowDeps): BrowserWindow {
  const state = deps.store.get();
  const options: BrowserWindowConstructorOptions = {
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    width: state.width,
    height: state.height,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    // No menu bar, and Alt does not bring one back (spec 007).
    autoHideMenuBar: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      // A hidden window must keep its timers on time: the session's idle check runs in the page, and a throttled page would lock late.
      backgroundThrottling: false,
    },
  };
  const win = new BrowserWindow(options);
  if (process.platform !== 'darwin') {
    win.removeMenu();
    win.setMenuBarVisibility(false);
  }
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  const remember = (): void => {
    if (win.isMaximized() || win.isMinimized() || win.isFullScreen()) return;
    const { x, y, width, height } = win.getBounds();
    deps.store.update({ x, y, width, height });
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('maximize', () => deps.store.update({ maximized: true }));
  win.on('unmaximize', () => deps.store.update({ maximized: false }));
  win.on('close', (event) => {
    deps.background.handleClose(event, win);
    deps.store.flush();
  });

  const devOrigin = deps.devUrl === undefined ? [] : [new URL(deps.devUrl).origin];
  lockDownContents(win.webContents, { openExternal: deps.openExternal, log: deps.log }, devOrigin);
  win.webContents.on('render-process-gone', (_event, details) => deps.log.error('window.render-process-gone', { reason: details.reason }));

  // The window behaves like an application: no selectable interface text, native pointers, shortcuts without a menu, a field menu, no pinch zoom.
  installNativeFeel(win.webContents);
  installShortcuts(win.webContents, win, { platform: process.platform, development: !app.isPackaged, pageLocked: deps.pageLocked, quit: () => app.quit() });
  installTextMenu(win.webContents, deps.language);
  void win.webContents.setVisualZoomLevelLimits(1, 1);

  void win.loadURL(deps.devUrl ?? `${APP_ORIGIN}/`);
  return win;
}
