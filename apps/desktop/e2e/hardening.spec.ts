import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCurrentFuseWire, FuseState, FuseV1Options } from '@electron/fuses';
import { headersForPath, parseHeadersFile } from '../src/main/headers';
import { APP_ORIGIN, appUnderTest, expect, readShellLog, test } from './fixtures';

// The shell is hardened (research R-D-09, R-D-11): the page is isolated and sandboxed, the policy of the web export is applied as response
// headers, and the page cannot navigate away, open windows, attach webviews, or reach Node.

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web');
const expectedHeaders = headersForPath(parseHeadersFile(readFileSync(join(webRoot, '_headers'), 'utf8')), '/sign-in/');

test('the page is isolated and sandboxed, with no way to reach Node', async ({ session }) => {
  const { app, page } = await session.launch();
  const prefs = await app.evaluate(({ BrowserWindow }) => (BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences());
  expect(prefs).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true });
  expect(await page.evaluate(() => [typeof require, typeof process, typeof module, typeof Buffer, typeof __dirname])).toEqual(Array(5).fill('undefined'));
});

test('serves every page with the security headers of the web export, and no HSTS', async ({ session }) => {
  const { page } = await session.launch();
  const [response] = await Promise.all([page.waitForResponse((r) => r.url() === `${APP_ORIGIN}/sign-in/`), page.goto(`${APP_ORIGIN}/sign-in/`)]);
  const headers = await response.allHeaders();
  for (const [name, value] of Object.entries(expectedHeaders)) expect(headers[name.toLowerCase()], name).toBe(value);
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['strict-transport-security']).toBeUndefined();
  expect(headers['content-type']).toBe('text/html; charset=utf-8');
});

test('serves WebAssembly with the type that streaming compilation needs', async ({ session }) => {
  const { page } = await session.launch();
  const result = await page.evaluate(async () => {
    const response = await fetch('/srp-bigint.wasm');
    return { status: response.status, type: response.headers.get('content-type'), bytes: (await response.arrayBuffer()).byteLength };
  });
  expect(result).toMatchObject({ status: 200, type: 'application/wasm' });
  expect(result.bytes).toBeGreaterThan(100);
});

test('refuses paths that try to leave the export, and answers unknown paths with the 404 page', async ({ session }) => {
  const { page } = await session.launch();
  const status = (path: string) => page.evaluate(async (p) => (await fetch(p)).status, path);
  expect(await status('/definitely-not-a-page/')).toBe(404);
  expect(await status('/%2e%2e/%2e%2e/etc/passwd')).toBe(404);
  expect(await status('/a/..%2f..%2f..%2fetc%2fpasswd')).toBe(404);
  expect(await status('/index.html%00.png')).toBe(404);
});

test('window.open opens nothing, and says so in the log', async ({ session }) => {
  const { app, page } = await session.launch();
  const opened = await page.evaluate(() => window.open('https://example.com/') !== null);
  expect(opened).toBe(false);
  await expect.poll(() => readShellLog(session.userDataDir).some((l) => l.event === 'security.window-open-blocked')).toBe(true);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('the page cannot navigate to another site', async ({ session }) => {
  const { page } = await session.launch();
  await page.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await expect.poll(() => readShellLog(session.userDataDir).some((l) => l.event === 'security.navigation-blocked')).toBe(true);
  expect(await page.evaluate(() => location.origin)).toBe(APP_ORIGIN);
});

test('a webview cannot be attached', async ({ session }) => {
  const { app, page } = await session.launch();
  await page.evaluate(() => {
    const view = document.createElement('webview');
    view.setAttribute('src', 'https://example.com/');
    document.body.appendChild(view);
  });
  await page.waitForTimeout(500);
  expect(await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => w.getType() === 'webview').length)).toBe(0);
});

test('exposes one frozen bridge and nothing else of the shell', async ({ session }) => {
  const { page } = await session.launch();
  const shape = await page.evaluate(() => {
    const bridge = (window as unknown as { cashfoldDesktop?: Record<string, unknown> }).cashfoldDesktop;
    return {
      present: typeof bridge === 'object' && bridge !== null,
      frozen: bridge !== undefined && Object.isFrozen(bridge),
      keys: bridge === undefined ? [] : Object.keys(bridge).sort(),
      settingsKeys: bridge === undefined ? [] : Object.keys((bridge['settings'] ?? {}) as object).sort(),
      testHooks: typeof (window as unknown as Record<string, unknown>)['__cashfoldTest'],
      electronGlobals: [typeof (window as unknown as Record<string, unknown>)['electron'], typeof (window as unknown as Record<string, unknown>)['ipcRenderer']],
    };
  });
  expect(shape).toEqual({ present: true, frozen: true, keys: [
      'about',
      'onFrameState',
      'onIncoming',
      'onMenuAction',
      'onSettingsChanged',
      'onSystemLock',
      'platform',
      'popupMenu',
      'reportSession',
      'revealDataFolder',
      'setBadge',
      'setLanguage',
      'setRecentFolds',
      'setTheme',
      'settings',
      'showWindow',
      'updates',
    ],
    settingsKeys: ['get', 'set'],
    testHooks: 'undefined',
    electronGlobals: ['undefined', 'undefined'],
  });
});

// Notifications are granted to the app's own page for reminders (spec 006); nothing else sensitive is.
test('grants the page persistent storage and notifications, and nothing else sensitive', async ({ session }) => {
  const { page } = await session.launch();
  const states = await page.evaluate(async () => {
    const query = async (name: string) => (await navigator.permissions.query({ name: name as PermissionName }).catch(() => ({ state: 'unsupported' }))).state;
    return { storage: await query('persistent-storage'), geolocation: await query('geolocation'), notifications: await query('notifications'), camera: await query('camera') };
  });
  expect(states.storage).toBe('granted');
  expect(states.geolocation).not.toBe('granted');
  expect(states.notifications).toBe('granted');
  expect(states.camera).not.toBe('granted');
});

test('the packaged app has its fuses set (R-D-09)', async () => {
  const { executablePath, packaged } = appUnderTest();
  test.skip(!packaged, 'only a packaged app has fuses to read');
  const wire = await getCurrentFuseWire(executablePath);
  expect(wire[FuseV1Options.RunAsNode]).toBe(FuseState.DISABLE);
  expect(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(FuseState.DISABLE);
  expect(wire[FuseV1Options.OnlyLoadAppFromAsar]).toBe(FuseState.ENABLE);
  expect(wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(FuseState.ENABLE);
  expect(wire[FuseV1Options.GrantFileProtocolExtraPrivileges]).toBe(FuseState.DISABLE);
});
