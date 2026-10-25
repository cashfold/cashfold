import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CHANNELS, type ShellLanguage } from '@cashfold/platform';
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, session, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { buildAbout } from './about';
import { BUILD_VERSION, SIGNED, TEST_FEED_ENABLED } from './build';
import { readBuildInfo } from './build-info';
import { checkDataFolder, problemMessage } from './data-folder';
import { revealDataFolder } from './data-location';
import { createDesktopStateStore } from './desktop-state';
import { loadResponseHeaders } from './headers';
import { registerIpc } from './ipc';
import { APP_ID, APP_NAME, RELEASE_PAGE_BASE, SOURCE_REPO_URL, UPDATE_PUBLIC_KEYS } from './identity';
import { createLogger } from './log';
import { buildMenu } from './menu';
import { languageFromSystem } from './menu-labels';
import { registerAppScheme, serveApp } from './protocol';
import { installSessionPolicy, isAllowedExternalUrl } from './security';
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
  /** The application menu, in a language; called at start and again whenever the app tells us it changed. */
  const installMenu = (language: ShellLanguage): void => {
    Menu.setApplicationMenu(buildMenu({ menu: Menu, isMac: process.platform === 'darwin', isDev: !app.isPackaged, openExternal, language }));
  };
  const devUrl = app.isPackaged ? undefined : process.env['CASHFOLD_DEV_URL'];
  let mainWindow: BrowserWindow | undefined;

  app.on('second-instance', () => {
    if (mainWindow === undefined) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  // The screen module (needed to place the window) only works once the app is ready.
  await app.whenReady();
  const store = createDesktopStateStore(join(userData, 'desktop-state.json'), () => screen.getAllDisplays().map((d) => d.workArea));
  app.on('before-quit', () => store.flush());
  const openWindow = (): BrowserWindow => createMainWindow({ store, log, openExternal, devUrl });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = openWindow();
  });
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

  // Updates (ADR-0010): a local feed and key exist only in the manual test build (TEST_FEED_ENABLED is compiled out of a release).
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

  registerIpc({
    ipcMain,
    log,
    ...(devUrl === undefined ? {} : { extraOrigins: [new URL(devUrl).origin] }),
    handlers: {
      about: () => aboutInfo,
      revealDataFolder: () => revealDataFolder({ userData, openPath: (path) => shell.openPath(path) }),
      setLanguage: (language) => installMenu(language),
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
  installMenu(languageFromSystem(app.getPreferredSystemLanguages()));
  mainWindow = openWindow();
  updates.start();
}
