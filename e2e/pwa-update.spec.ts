import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures/index.js';
import { signUpAndEnter } from './fixtures/nav.js';
import { startVersionedServer, type VersionedServer } from './fixtures/versioned-server.js';

// Spec 009, user story 2: a new version waits, the person is told, and the switch never loses what they typed. A new version is pretended by a small
// server in front of the app (fixtures/versioned-server.ts) that changes the version baked into the worker; the new worker installs, with the same files
// and hashes, and waits, exactly as a real deploy does.

// Each browser project runs in its own worker, and each worker owns one versioned server on its own port.
const PORTS: Record<string, number> = { chromium: 3300, firefox: 3301, webkit: 3302 };
const portOf = (project: string): number => PORTS[project] ?? 3310;
const NEW = 'a'.repeat(16);
const NEWER = 'b'.repeat(16);

let server: VersionedServer;
const test = base.extend({
  baseURL: async ({}, use, testInfo) => {
    await use(`http://localhost:${portOf(testInfo.project.name)}`);
  },
});
test.beforeAll(async ({}, testInfo) => {
  server = await startVersionedServer('http://localhost:3100', portOf(testInfo.project.name));
});
test.afterAll(async () => {
  await server?.close();
});
test.beforeEach(() => {
  server.setVersion(null);
  server.failPath(null);
  server.holdPath(null);
});
// One worker runs the whole file: it owns the versioned server's port.
test.describe.configure({ mode: 'serial' });

test.describe('@pwa update', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'service-worker behaviour is verified on Chromium and Firefox');
  });

  const notice = (page: Page) => page.getByTestId('web-update-notice');
  const checkForUpdate = (page: Page) => page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update().catch(() => undefined); });
  const controlled = (page: Page) => expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 }).toBe(true);

  async function signedInAndControlled(page: Page): Promise<void> {
    await signUpAndEnter(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await controlled(page);
  }

  test('a new version is announced quietly, can be dismissed for that version, and comes back for the next', async ({ page }) => {
    test.setTimeout(240_000);
    await signedInAndControlled(page);
    await expect(notice(page)).toHaveCount(0);
    server.setVersion(NEW);
    await checkForUpdate(page);
    await expect(notice(page)).toContainText('A new version of Cashfold is ready', { timeout: 60_000 }); // SC-003: within a minute
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement?.closest('[data-testid=web-update-notice]') === null)).toBe(true);
    await notice(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice(page)).toHaveCount(0);
    await checkForUpdate(page);
    await page.waitForTimeout(1_500);
    await expect(notice(page)).toHaveCount(0);
    server.setVersion(NEWER);
    await checkForUpdate(page);
    await expect(notice(page)).toContainText('new version', { timeout: 60_000 });
  });

  test('refuses to update over typed input, keeps it, and updates once it is saved or discarded', async ({ page }) => {
    test.setTimeout(240_000);
    await signedInAndControlled(page);
    // A field that is not in a dialog (a dialog would also cover the notice): any field holding typed input counts, so one is put on the page.
    await page.evaluate(() => {
      const field = document.createElement('input');
      field.id = 'probe';
      field.type = 'text';
      field.setAttribute('aria-label', 'Probe');
      document.querySelector('main')!.append(field);
      (window as unknown as { __marker?: number }).__marker = 1;
    });
    const probe = page.getByLabel('Probe');
    await probe.fill('12.50');
    server.setVersion(NEW);
    await checkForUpdate(page);
    await expect(notice(page)).toBeVisible({ timeout: 60_000 });
    await notice(page).getByRole('button', { name: 'Update' }).click();
    await expect(notice(page)).toContainText('Save or discard what you are typing');
    await expect(probe).toHaveValue('12.50');
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1); // no reload happened
    await probe.fill('');
    await expect(notice(page)).not.toContainText('Save or discard', { timeout: 10_000 });
    await notice(page).getByRole('button', { name: 'Update' }).click();
    // The restart shows the unlock screen, as any restart does.
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBeUndefined();
  });

  test('another open window says the app was updated and restarts by itself', async ({ page, context }) => {
    test.setTimeout(240_000);
    await signedInAndControlled(page);
    const other = await context.newPage();
    await other.goto('/sign-in/');
    await other.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect.poll(() => other.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 }).toBe(true);
    await other.evaluate(() => ((window as unknown as { __marker?: number }).__marker = 1));
    server.setVersion(NEW);
    await checkForUpdate(page);
    await expect(notice(page)).toBeVisible({ timeout: 60_000 });
    await notice(page).getByRole('button', { name: 'Update' }).click();
    // It restarted: the marker is gone (a read during the reload itself fails, which also means it is going).
    await expect.poll(() => other.evaluate(() => (window as unknown as { __marker?: number }).__marker).catch(() => undefined), { timeout: 60_000 }).toBeUndefined();
  });

  test('a version that fails to install leaves the current one working, offline and online, and shows nothing', async ({ page, context }) => {
    test.setTimeout(240_000);
    await signedInAndControlled(page);
    const manifest = (await (await page.request.get('/precache-manifest.json')).json()) as { files: { url: string }[] };
    const script = manifest.files.find((f) => f.url.endsWith('.js') && f.url !== '/sw.js')!.url;
    server.setVersion(NEW);
    server.failPath(script);
    await checkForUpdate(page);
    await page.waitForTimeout(3_000);
    await expect(notice(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting === null)).toBe(true);
    await context.setOffline(true);
    await page.goto('/sign-in/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await context.setOffline(false);
    // When the file is back, the next check finds the version.
    server.failPath(null);
    await checkForUpdate(page);
    await expect(notice(page)).toBeVisible({ timeout: 60_000 });
  });

  test('a version whose download never finishes does not disturb the running app', async ({ page }) => {
    test.setTimeout(240_000);
    await signedInAndControlled(page);
    const manifest = (await (await page.request.get('/precache-manifest.json')).json()) as { files: { url: string }[] };
    const script = manifest.files.find((f) => f.url.endsWith('.js') && f.url !== '/sw.js')!.url;
    server.setVersion(NEW);
    server.holdPath(script);
    void checkForUpdate(page);
    await page.waitForTimeout(2_000);
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible();
    server.release();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the notice has no accessibility violations (${scheme} theme)`, async ({ page, expectNoA11yViolations }) => {
      test.setTimeout(240_000);
      await page.emulateMedia({ colorScheme: scheme });
      await signedInAndControlled(page);
      server.setVersion(NEW);
      await checkForUpdate(page);
      await expect(notice(page)).toBeVisible({ timeout: 60_000 });
      await expectNoA11yViolations();
      await page.setViewportSize({ width: 360, height: 700 });
      await expectNoA11yViolations();
    });
  }
});
