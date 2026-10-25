import type { ElectronApplication, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { go } from '../../../e2e/fixtures/nav.js';
import { expect, signUp, test } from './fixtures';

// User story 1 (spec 006): in the desktop app the computer locking, sleeping or idling locks the app; clicking another window does not.
// The system events are simulated through the test hooks (a real lock screen is checked by hand: verification V1 to V3).

const emitPower = (app: ElectronApplication, event: 'lock-screen' | 'suspend' | 'resume') =>
  app.evaluate((_electron, name) => (globalThis as unknown as { __cashfoldTest: { emitPower(event: string): void } }).__cashfoldTest.emitPower(name), event);

/** What the window shows besides the unlock screen: the app's own content. */
const showsContent = (page: Page) => page.getByTestId('current-fold').first();
const unlockScreen = (page: Page) => page.getByRole('heading', { name: 'Unlock Cashfold' });

async function setIdleMinutes(page: Page, minutes: number): Promise<void> {
  await go(page, 'Profile');
  await page.getByLabel('Lock after no activity for').selectOption({ value: String(minutes) });
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
}

test('clicking another window keeps the data on screen', async ({ session }) => {
  const { page } = await session.launch();
  await signUp(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(500);
  await expect(page.getByTestId('privacy-cover')).toHaveCount(0);
  await expect(showsContent(page)).toBeVisible();
});

for (const event of ['lock-screen', 'suspend'] as const) {
  test(`the computer's ${event} event locks the app within five seconds, with no content left in the window`, async ({ session }) => {
    const { app, page } = await session.launch();
    await signUp(page);
    await emitPower(app, event);
    await expect(unlockScreen(page)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('current-fold')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });
}

test('with "hide on switch" turned on, switching away covers the content at once, and coming back needs no password', async ({ session }) => {
  const { page } = await session.launch();
  await signUp(page);
  await go(page, 'Desktop');
  await page.getByTestId('desktop-hide-on-blur').click();
  await expect(page.getByTestId('desktop-hide-on-blur')).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByTestId('privacy-cover')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('privacy-cover')).toHaveCount(0);
  await expect(unlockScreen(page)).toHaveCount(0);
});

test('the choice to hide on switch survives a restart', async ({ session }) => {
  const first = await session.launch();
  await signUp(first.page);
  await go(first.page, 'Desktop');
  await first.page.getByTestId('desktop-hide-on-blur').click();
  await expect(first.page.getByTestId('desktop-hide-on-blur')).toHaveAttribute('aria-checked', 'true');
  await session.quit(first.app);
  const state = JSON.parse(readFileSync(join(session.userDataDir, 'desktop-state.json'), 'utf8')) as { hideOnBlur: boolean };
  expect(state.hideOnBlur).toBe(true);
  const second = await session.launch();
  await go(second.page, 'Desktop').catch(() => undefined); // locked after a restart: only the stored value matters here
});

test('a hidden window is not locked by the old one-minute timer, and locks at the idle time', async ({ session }) => {
  test.setTimeout(240_000);
  const { app, page } = await session.launch();
  await signUp(page);
  await setIdleMinutes(page, 2);
  const started = Date.now();
  // Stays hidden throughout: showing it would put a window under the pointer, which counts as input and would restart the idle time.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide());
  await page.waitForTimeout(90_000);
  // 90 seconds in: the browser rule (hidden for a minute) would have locked it long ago.
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(false);
  await expect(unlockScreen(page)).toHaveCount(0);
  // Two minutes of no input in all: locked, although the window is hidden.
  await page.waitForTimeout(Math.max(0, 128_000 - (Date.now() - started)));
  await expect(unlockScreen(page)).toBeVisible({ timeout: 15_000 });
});
