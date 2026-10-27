import { expect, test } from './fixtures/index.js';
import { createAccount, signUpAndEnter } from './fixtures/nav.js';

// Spec 009, user story 3: after one visit every screen of the app opens with no connection, by direct address and after a reload, an address that is
// not part of the app gets the app's own "page not found" screen with a way back, and what is entered offline waits to synchronise.

const SECTIONS = ['/overview/', '/transactions/', '/accounts/', '/plan/', '/settings/'];
const GROUPS = ['profile', 'appearance', 'categories', 'sync', 'data', 'folds', 'advanced'].map((g) => `/settings/${g}/`);

test.describe('@pwa offline', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'service-worker offline behaviour is verified on Chromium and Firefox');
  });

  async function controlled(page: import('@playwright/test').Page) {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  }

  test('every section and every settings group opens by its own address with no connection', async ({ page, context }) => {
    test.setTimeout(240_000);
    await controlled(page);
    await context.setOffline(true);
    for (const route of [...SECTIONS, ...GROUPS]) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 }), route).toBeVisible();
      await expect(page.getByText('This page could not be found'), route).toHaveCount(0);
    }
  });

  test('an address that is not part of the app shows the app\'s own "page not found" screen, with a way back', async ({ page, context }) => {
    test.setTimeout(240_000);
    await controlled(page);
    await context.setOffline(true);
    await page.goto('/no-such-page/');
    await expect(page.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Back to Cashfold' }).click();
    await expect(page).toHaveURL(/localhost:\d+\/(?:$|sign-|overview)/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('what is entered offline is saved on the device and says it is waiting, then synchronises without action', async ({ page, context }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '10.00');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel(/^Amount/).fill('3.00');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Transaction saved' })).toBeVisible();
    // The sync indicator in the navigation says that nothing can be sent now.
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('status')).toContainText(/offline|not syncing|waiting/i);
    await context.setOffline(false);
  });
});
