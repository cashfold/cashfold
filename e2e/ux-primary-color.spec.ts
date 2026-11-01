import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go } from './fixtures/nav.js';

// Primary colour (spec 014): the person picks a colour in Settings → Appearance, the app follows it at once, it survives a reload with no flash of
// the default, it works offline, and Default brings the original back. The app icon does not follow it (spec 018): there is one icon.

const PASSWORD = 'correct horse battery staple';

test.beforeEach(({ browserName }) => {
  test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
});

/** A new account kept on this device (no service needed), then Settings → Appearance. */
async function toAppearance(page: Page): Promise<void> {
  await page.goto('/sign-up/');
  await page.getByLabel('Email address', { exact: true }).fill('alice@example.com');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('I have saved my Secret Key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('current-fold')).toHaveText('Personal');
  await go(page, 'Appearance');
  await expect(page.getByRole('heading', { level: 1, name: 'Appearance' })).toBeVisible();
}

const primaryOf = (page: import('@playwright/test').Page) => page.locator('html').getAttribute('data-primary');
const cssPrimary = (page: import('@playwright/test').Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());

/** The one icon: the same links whatever the colour (spec 018, FR-007, FR-008). */
async function expectOneIcon(page: Page): Promise<void> {
  await expect(page.locator('link[rel~="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/icon.svg');
  await expect(page.locator('link[rel~="icon"][href$=".ico"]')).toHaveAttribute('href', '/favicon.ico');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
}

test('picking a colour re-themes the app and not its icon, and the choice survives a reload with no flash', async ({ page }) => {
  await toAppearance(page);
  await expect(page.locator('html')).toHaveAttribute('data-primary', 'emerald');
  await page.getByRole('radio', { name: /Violet/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-primary', 'violet');
  await expect.poll(() => cssPrimary(page)).toMatch(/^#(6d28d9|a78bfa)$/);
  // The icon links never change, the address-bar colour follows the colour, and Appearance says nothing about an icon.
  await expectOneIcon(page);
  await expect.poll(() => page.locator('meta[name="theme-color"]').first().getAttribute('content')).toMatch(/^#(6d28d9|a78bfa)$/);
  await expect(page.getByRole('main')).not.toContainText(/icon|reinstall/i);

  await page.reload();
  // The page is locked again after a reload; the start-up script has still set the colour before anything is unlocked.
  await expect(page.locator('html')).toHaveAttribute('data-primary', 'violet');
  expect(await primaryOf(page)).toBe('violet');
});

test('the start-up script applies the stored colour before the app loads', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cashfold.ui', JSON.stringify({ v: 1, primary: 'amber' })));
  // Block the app's own scripts: only the inline start-up script can have set the attribute.
  await page.route('**/_next/static/**/*.js', (route) => route.abort());
  await page.goto('/settings/appearance/');
  await expect(page.locator('html')).toHaveAttribute('data-primary', 'amber');
});

test('an unknown stored colour falls back to the default', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cashfold.ui', JSON.stringify({ v: 1, primary: 'purple' })));
  await page.goto('/settings/appearance/');
  await expect(page.locator('html')).toHaveAttribute('data-primary', 'emerald');
});

test('Default brings the original colour back, and a colour can be chosen with no connection', async ({ page, context }) => {
  await toAppearance(page);
  await page.getByRole('radio', { name: /Orange/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-primary', 'orange');
  await context.setOffline(true);
  await page.getByRole('radio', { name: /Teal/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-primary', 'teal');
  await context.setOffline(false);
  await page.getByRole('radio', { name: /Emerald/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-primary', 'emerald');
  await expectOneIcon(page);
});

test('every colour leaves the icon links as they are', async ({ page }) => {
  await toAppearance(page);
  for (const name of [/Teal/, /Pink/, /Slate/, /Amber/]) {
    await page.getByRole('radio', { name }).click();
    await expectOneIcon(page);
  }
});

test('the colour picker has no accessibility violations for any colour', async ({ page, expectNoA11yViolations }) => {
  await toAppearance(page);
  for (const name of [/Blue/, /Amber/, /Slate/]) {
    await page.getByRole('radio', { name }).click();
    await expectNoA11yViolations();
  }
});
