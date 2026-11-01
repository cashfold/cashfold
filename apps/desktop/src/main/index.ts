import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, release } from 'node:os';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CHANNELS, type Capabilities, type DesktopSettings, type ShellLanguage } from '@cashfold/platform';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, powerMonitor, protocol, screen, session, shell, Tray } from 'electron';
import { autoUpdater } from 'electron-updater';
import { buildAbout } from './about';
import { createAppearance } from './appearance';
import { popupContextMenu } from './context-menu';
import { createBackgroundMode } from './background';
import { createBadge } from './badge';
import { BUILD_VERSION, SIGNED, TEST_FEED_ENABLED } from './build';
import { readBuildInfo } from './build-info';
import { describeCapabilities, windowsBuildFrom } from './capabilities';
import { checkDataFolder, problemMessage } from './data-folder';
import { revealDataFolder } from './data-location';
import { applySettingsUpdate, keepsRunningWhenClosed } from './desktop-settings';
import { createDesktopStateStore } from './desktop-state';
import { loadResponseHeaders } from './headers';
import { createFrame } from './frame';
import { createIntake } from './intake';
import { registerIpc } from './ipc';
import { APP_ID, APP_NAME, RELEASE_PAGE_BASE, SOURCE_REPO_URL, UPDATE_PUBLIC_KEYS } from './identity';
import { applyStartAtLogin, startedAtLogin, type LaunchDeps } from './launch';
import { createLogger } from './log';
import { buildMenu } from './menu';
import { labelsFor, languageFromSystem } from './menu-labels';
import { registerAppScheme, serveApp } from './protocol';
import { installSessionPolicy, isAllowedExternalUrl } from './security';
import { createSystemEvents } from './system-events';
import { exposeTestHook } from './test-hooks';
import { createPresence, parseLaunchAction, type QuickAction } from './tray';
import { createUpdaterService, type UpdaterLike } from './updater';
import { fetchSmallText, sha512OfFile, verifyDownload } from './update-verify';
import { createMainWindow } from './window';

// The user-data folder is where the browser engine keeps the app's data (OPFS, IndexedDB). Its name is derived from the app name, and it must
// never change once a release exists (identity.test.ts). A test may point the app at its own folder with --user-data-dir.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', join(app.getPath('appData'), APP_NAME));
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// Registering the scheme has to happen before the app is ready.
registerAppScheme(protocol);

// Make sure the data can be saved before anything opens it: a folder that cannot be written would let the session's work be lost.
const dataFolder = checkDataFolder(app.getPath('userData'));
// No window and no saved choice exist yet, so this dialog follows the operating system's language.
const blocking = problemMessage(dataFolder, app.getPath('userData'), languageFromSystem(app.getPreferredSystemLanguages()));

// macOS tells the app which file or link was opened, possibly before it is ready; they wait here until the intake exists.
const earlyArguments: string[] = [];
let acceptArgument: (argument: string) => void = (argument) => void earlyArguments.push(argument);
app.on('open-file', (event, path) => {
  event.preventDefault();
  acceptArgument(path);
});
app.on('open-url', (event, url) => {
  event.preventDefault();
  acceptArgument(url);
});

if (blocking !== undefined) {
  dialog.showErrorBox(blocking.title, blocking.detail);
  app.exit(1);
} else if (!app.requestSingleInstanceLock()) {
  // Another instance owns this data folder; it will be brought to the front (second-instance there).
  app.quit();
} else {
  main().catch((error: unknown) => {
    // A failure to start must be loud, not a silent unhandled rejection with no window.
    console.error('Cashfold failed to start:', error);
    app.exit(1);
  });
}

async function main(): Promise<void> {
  const userData = app.getPath('userData');
  const log = createLogger({ dir: join(userData, 'logs'), dataDir: userData, console: !app.isPackaged });
  if (dataFolder.kind === 'low-space') log.warn('storage.low-space', { freeMiB: Math.floor(dataFolder.freeBytes / (1024 * 1024)) });
  const openExternal = (url: string): Promise<void> => shell.openExternal(url);
  // The language the app is shown in: the system's at first, then whatever the app tells us. It words the shell's own right-click menu and dialogs.
  let language: ShellLanguage = languageFromSystem(app.getPreferredSystemLanguages());
  // Windows and Linux have no menu bar at all; macOS keeps the menu named after the app (spec 007).
  Menu.setApplicationMenu(buildMenu({ menu: Menu, isMac: process.platform === 'darwin' }));
  const devUrl = app.isPackaged ? undefined : process.env['CASHFOLD_DEV_URL'];
  let mainWindow: BrowserWindow | undefined;
  // Whether the page has a listener for items from outside; false again whenever a new document loads (a reload drops the listener).
  let incomingReady = false;
  // Closing the window hides it instead when the person chose that (quit is the default on Windows and Linux, keep running on macOS), and only where
  // a tray or menu-bar item can bring the app back. Read at each close, so a change in Settings applies at once.
  const background = createBackgroundMode({ enabled: () => keepsRunningWhenClosed(store.get(), capabilities().statusItem) });
  app.on('before-quit', () => background.markQuitting());

  app.on('window-all-closed', () => {
    if (background.quitWhenAllClosed(process.platform)) app.quit();
  });
  // The screen module (needed to place the window) only works once the app is ready.
  await app.whenReady();
  const store = createDesktopStateStore(join(userData, 'desktop-state.json'), () => screen.getAllDisplays().map((d) => d.workArea));
  // The colours, set before any window exists so the first frame is already in the right theme.
  const appearance = createAppearance({ nativeTheme, store });
  appearance.start();
  app.on('before-quit', () => store.flush());
  // The frame: the app's own bar on macOS and Windows, the translucent material where the system has one, switched off live when transparency is reduced.
  const frame = createFrame({ platform: process.platform, translucency: () => capabilities().translucency, isDark: () => appearance.isDark(), setTransparent: (on) => appearance.setTransparent(on) });
  appearance.onChange(() => frame.refresh());
  // Started by the login item: the window stays hidden (the tray or menu-bar icon brings it), and with no session the app is locked. Where nothing could
  // bring a hidden window back (no tray icon), it is shown anyway.
  const launchDeps: LaunchDeps = {
    platform: process.platform,
    loginItems: app,
    files: { mkdir: (path) => void mkdirSync(path, { recursive: true }), write: (path, content) => writeFileSync(path, content, 'utf8'), remove: (path) => rmSync(path, { force: true }) },
    env: process.env,
    execPath: process.execPath,
    homeDir: homedir(),
    appName: APP_NAME,
  };
  let hiddenStartPending = startedAtLogin(process.argv, launchDeps);
  /** True once, for the first window of a login start; `capabilities` is defined further down and is only called when the window is made. */
  const takeHiddenStart = (): boolean => {
    const hidden = hiddenStartPending && capabilities().statusItem;
    hiddenStartPending = false;
    return hidden;
  };
  const openWindow = (): BrowserWindow => {
    const win = createMainWindow(windowDeps);
    // Only a new document drops the page's listener; a move inside the app (the router) does not.
    win.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) incomingReady = false;
    });
    return win;
  };
  // `startHidden` is read when the window is made (a getter), so only the first window of a login start is kept hidden.
  const windowDeps = {
    store, background, log, openExternal, devUrl, pageLocked: () => pageSession === 'locked', language: () => language, appearance, frame,
    get startHidden(): boolean {
      return takeHiddenStart();
    },
  };
  app.on('activate', () => showWindow());
  log.info('app.start', { version: app.getVersion(), electron: process.versions.electron, packaged: app.isPackaged });

  if (BUILD_VERSION !== undefined && BUILD_VERSION !== app.getVersion()) log.error('app.version-mismatch', { built: BUILD_VERSION, packaged: app.getVersion() });
  const buildInfo = readBuildInfo(app.getAppPath());
  const described = buildAbout({
    version: app.getVersion(),
    ...(buildInfo.commit === undefined ? {} : { commit: buildInfo.commit }),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    env: process.env,
    execPath: process.execPath,
    exists: existsSync,
    signed: SIGNED,
    userData,
  });
  // The update tests run unpacked, where a copy would be told to update by hand: a test build can say otherwise. A release has no such switch.
  const testMode = TEST_FEED_ENABLED && process.env['CASHFOLD_TEST_UPDATE_MODE'] === 'in-app';
  const aboutInfo = testMode ? { ...described, updateMode: 'in-app' as const } : described;

  // Updates: a local feed and key exist only in the manual test build (TEST_FEED_ENABLED is compiled out of a release).
  const testFeed = TEST_FEED_ENABLED ? process.env['CASHFOLD_TEST_FEED'] : undefined;
  const testKey = TEST_FEED_ENABLED ? process.env['CASHFOLD_TEST_UPDATE_KEY'] : undefined;
  if (testFeed !== undefined) {
    autoUpdater.setFeedURL({ provider: 'generic', url: testFeed });
    autoUpdater.forceDevUpdateConfig = true;
  }
  autoUpdater.logger = null; // our own log, with its redaction, is the only one
  const downloadBase = testFeed ?? `${SOURCE_REPO_URL}/releases/download`;
  const updates = createUpdaterService({
    updater: autoUpdater as unknown as UpdaterLike,
    mode: aboutInfo.updateMode,
    currentVersion: app.getVersion(),
    store,
    verify: (file, version) =>
      verifyDownload({
        file,
        version,
        publicKeys: [...UPDATE_PUBLIC_KEYS, ...(testKey === undefined ? [] : [testKey])],
        hashFile: sha512OfFile,
        fetchText: (url) => fetchSmallText(url, testFeed === undefined ? {} : { allowHttpPrefix: `${testFeed}/` }),
        signaturesFrom: downloadBase,
      }),
    remove: (file) => rm(file, { force: true }),
    emit: (state) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(CHANNELS.updateChanged, state)),
    log,
    releaseBase: RELEASE_PAGE_BASE,
    pinnedDownloadBase: downloadBase,
  });
  app.on('before-quit', () => updates.stop());

  // What the page last said about its session. A hint: the shell holds nothing sensitive either way.
  let pageSession: 'locked' | 'unlocked' = 'locked';
  const systemEvents = createSystemEvents({
    monitor: powerMonitor,
    send: (event) => {
      if (mainWindow === undefined || mainWindow.isDestroyed()) return false;
      mainWindow.webContents.send(CHANNELS.systemLock, event);
      return true;
    },
    pageLocked: () => pageSession === 'locked',
    // A locked computer shows nothing of ours: the count and the Fold names go at once, whether or not the page answers.
    onSystemLock: () => {
      badge.clear();
      presence.clearRecent();
    },
  });
  systemEvents.start();
  app.on('before-quit', () => systemEvents.stop());
  exposeTestHook('emitPower', (event: 'lock-screen' | 'suspend' | 'resume') => powerMonitor.emit(event));

  const settingsOf = (): DesktopSettings => {
    const { hideOnBlur, startAtLogin, closeBehavior, theme } = store.get();
    return { hideOnBlur, startAtLogin, closeBehavior, theme };
  };
  const capabilities = (): Capabilities =>
    describeCapabilities({
      platform: process.platform,
      desktop: process.env['XDG_CURRENT_DESKTOP'],
      windowsBuild: process.platform === 'win32' ? windowsBuildFrom(release()) : undefined,
      reducedTransparency: nativeTheme.prefersReducedTransparency,
      highContrast: nativeTheme.shouldUseHighContrastColors,
      // The page's reminders are shown natively; permission is granted to the app's own page in security.ts.
      notifications: Notification.isSupported() ? 'granted' : 'unavailable',
    });

  // The count on the dock icon or taskbar button, and the tray, dock menu and jump list. They show what the unlocked page tells them and nothing
  // while it is locked. Images are read from inside the package.
  const imageAt = (...parts: string[]) => nativeImage.createFromPath(join(app.getAppPath(), 'build', ...parts));
  const badge = createBadge({
    platform: process.platform,
    setBadgeCount: (count) => void app.setBadgeCount(count),
    setOverlay: (image, description) => mainWindow?.setOverlayIcon(image, description),
    image: (name) => imageAt('badges', `${name}.png`),
    labels: () => labelsFor(language),
  });
  /** The window, made again if it is gone (macOS keeps the app running with no window). */
  const showWindow = (): void => {
    if (mainWindow === undefined || mainWindow.isDestroyed()) mainWindow = openWindow();
    else background.reveal(mainWindow);
  };
  /** What a quick action asks. Data actions reach the page only while it is unlocked; a locked app just shows its window to unlock. */
  const perform = (action: QuickAction): void => {
    if (action === 'quit') return void app.quit();
    showWindow();
    if (action === 'show') return;
    const pageAction = action === 'add-transaction' ? 'new-transaction' : action;
    if (action === 'lock' || pageSession === 'unlocked') mainWindow?.webContents.send(CHANNELS.menuAction, { action: pageAction });
  };
  const presence = createPresence({
    platform: process.platform,
    statusItem: capabilities().statusItem,
    labels: () => labelsFor(language),
    unlocked: () => pageSession === 'unlocked',
    menu: Menu,
    createTray: () => {
      const tray = new Tray(imageAt('tray', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
      return tray;
    },
    ...(process.platform === 'darwin' ? { setDockMenu: (menu: Electron.Menu) => app.dock?.setMenu(menu) } : {}),
    ...(process.platform === 'win32' ? { setJumpList: (categories: unknown) => void app.setJumpList(categories as Electron.JumpListCategory[]) } : {}),
    program: process.execPath,
    appName: APP_NAME,
    perform,
  });
  app.on('before-quit', () => {
    badge.clear();
    presence.dispose();
  });
  exposeTestHook('badge', () => badge.current());
  exposeTestHook('presence', () => presence.models());
  // What arrives from outside: files and links, held by the shell until the page can take them (intake.ts).
  const intake = createIntake({
    send: (item) => {
      if (mainWindow === undefined || mainWindow.isDestroyed()) return false;
      mainWindow.webContents.send(CHANNELS.incoming, item);
      return true;
    },
    pageReported: () => incomingReady,
    unlocked: () => pageSession === 'unlocked',
    log,
  });
  exposeTestHook('intakeQueued', () => intake.queued());
  exposeTestHook('incomingReady', () => incomingReady);
  app.on('before-quit', () => intake.clear());
  app.on('second-instance', (_event, argv) => {
    for (const argument of argv.slice(1)) intake.accept(argument);
    const action = parseLaunchAction(argv);
    if (action === undefined) showWindow();
    else perform(action);
  });

  registerIpc({
    ipcMain,
    log,
    ...(devUrl === undefined ? {} : { extraOrigins: [new URL(devUrl).origin] }),
    handlers: {
      about: () => aboutInfo,
      revealDataFolder: () => revealDataFolder({ userData, openPath: (path) => shell.openPath(path) }),
      setLanguage: (next) => {
        language = next;
        presence.refresh();
      },
      updateState: () => updates.state(),
      updateCheck: () => updates.check(),
      updateDownload: () => updates.download(),
      updateInstall: () => updates.install(),
      openReleasePage: async () => {
        const url = updates.releasePageUrl();
        if (!isAllowedExternalUrl(url)) throw new Error('not an allowed address');
        await openExternal(url);
      },
      autoCheck: (set) => (set === undefined ? updates.autoCheck() : updates.setAutoCheck(set)),
      settings: () => ({ settings: settingsOf(), capabilities: capabilities() }),
      settingsSet: (update) => {
        store.update(applySettingsUpdate(settingsOf(), update, capabilities().statusItem));
        // The choice is kept whatever happens; the answer says whether the system took it, for Settings to show.
        const applied = update.startAtLogin === undefined ? { applied: true } : applyStartAtLogin(update.startAtLogin, launchDeps);
        return { settings: settingsOf(), applied: { startAtLogin: applied.applied } };
      },
      setTheme: (theme) => appearance.set(theme),
      reportSession: (state) => {
        pageSession = state;
        // A change of session lets the files that were held for an unlock through.
        intake.flush();
        if (state === 'locked') {
          badge.clear();
          presence.clearRecent();
        }
      },
      setBadge: (count) => badge.set(count),
      setRecentFolds: (folds) => presence.setRecentFolds(folds),
      popupMenu: (items) => popupContextMenu({ menu: Menu, window: () => mainWindow }, items),
      showWindow: () => showWindow(),
      incomingReady: () => {
        incomingReady = true;
        intake.flush();
      },
    },
  });

  // The folder the last backup or export went to, kept in memory only: where a person saves is not something to write down.
  let saveFolder = app.getPath('downloads');

  const webRoot = join(app.getAppPath(), 'dist', 'web');
  serveApp(protocol, { webRoot, rules: loadResponseHeaders(webRoot) });
  installSessionPolicy({
    session: session.defaultSession,
    openExternal,
    log,
    saveDialogOptions: (filename) => ({ defaultPath: join(saveFolder, filename) }),
    onSaved: (savedPath) => {
      saveFolder = dirname(savedPath);
    },
  });
  // The choice is kept in step with the system (an AppImage moves, an entry may have been removed by hand).
  if (store.get().startAtLogin) applyStartAtLogin(true, launchDeps);
  // An unpackaged run has no installer to register the `cashfold://` scheme: do it for the run (a packaged app is registered by its installer).
  if (!app.isPackaged && process.argv[1] !== undefined) app.setAsDefaultProtocolClient('cashfold', process.execPath, [resolve(process.argv[1])]);
  mainWindow = openWindow();
  for (const argument of process.argv.slice(1)) intake.accept(argument);
  for (const argument of earlyArguments.splice(0)) intake.accept(argument);
  acceptArgument = (argument) => {
    intake.accept(argument);
    showWindow();
  };
  presence.start();
  updates.start();
}
