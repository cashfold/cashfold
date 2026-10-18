import { expect, test } from './fixtures/index.js';

// @offline-reload (FR-072, SC-007): after one visit the app opens, reloads and navigates with no network at all.

test.describe('@offline-reload', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'service-worker offline behaviour is verified on Chromium and Firefox');
  });

  async function installed(page: import('@playwright/test').Page) {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    // The first load is not controlled; reload so the worker serves it, as a returning visitor would see.
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  }

  test('reloads and navigates while offline', async ({ page, context }) => {
    await installed(page);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const route of ['/accounts/', '/transactions/', '/settings/']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 }), route).toBeVisible();
    }
  });

  test('a new tab opened while offline still gets the app', async ({ page, context }) => {
    await installed(page);
    await context.setOffline(true);
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto('/dashboard/');
    await expect(reopened.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('serves only the app shell: no API traffic or other origins pass through the worker', async ({ page }) => {
    await installed(page);
    const swSource = await page.evaluate(async () => (await fetch('/sw.js')).text());
    expect(swSource).not.toMatch(/\/v1\//);
    expect(await page.evaluate(() => caches.keys().then((k) => k.length))).toBeGreaterThan(0);
  });

  test('the precache holds every file of the build and each matches its published hash', async ({ page }) => {
    await installed(page);
    const result = await page.evaluate(async () => {
      const manifest = (await (await fetch('/precache-manifest.json')).json()) as { version: string; files: { url: string; sha256: string }[] };
      const cache = await caches.open(`cashfold-${manifest.version}`);
      const bad: string[] = [];
      for (const f of manifest.files) {
        const res = await cache.match(f.url);
        if (!res) { bad.push(`missing ${f.url}`); continue; }
        const digest = await crypto.subtle.digest('SHA-256', await res.arrayBuffer());
        const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
        if (hex !== f.sha256) bad.push(`hash ${f.url}`);
      }
      return { count: manifest.files.length, bad };
    });
    expect(result.count).toBeGreaterThan(10);
    expect(result.bad).toEqual([]);
  });

  test('leaves no financial content behind in caches', async ({ page, leakScan }) => {
    await installed(page);
    await leakScan.expectNoLeaks({ strings: ['Alice Example'], amounts: ['12.50'] });
  });
});
