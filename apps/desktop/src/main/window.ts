import { join } from 'node:path';
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { APP_NAME, APP_ORIGIN } from './identity';
import type { DesktopStateStore } from './desktop-state';
import type { Logger } from './log';
import { lockDownContents } from './security';

export interface WindowDeps {
  readonly store: DesktopStateStore;
  readonly log: Logger;
  readonly openExternal: (url: string) => Promise<void>;
  /** Only in an unpackaged run: a dev server to load instead of the packaged export. */
  readonly devUrl: string | undefined;
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
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
    },
  };
  const win = new BrowserWindow(options);
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
  win.on('close', () => deps.store.flush());

  const devOrigin = deps.devUrl === undefined ? [] : [new URL(deps.devUrl).origin];
  lockDownContents(win.webContents, { openExternal: deps.openExternal, log: deps.log }, devOrigin);
  win.webContents.on('render-process-gone', (_event, details) => deps.log.error('window.render-process-gone', { reason: details.reason }));

  void win.loadURL(deps.devUrl ?? `${APP_ORIGIN}/`);
  return win;
}
