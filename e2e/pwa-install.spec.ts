import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go, signUpAndEnter, unlock } from './fixtures/nav.js';

// Spec 009, user story 1 (install) and the first screen of story 4: the install section appears only where installing can help and never unasked,
// it calls the browser's prompt when a person presses Install, and it is hidden in an installed window. The browser's own install event is simulated:
// the real one needs a real install, which is a manual step in specs/009-installable-web-app/quickstart.md.

const PASSWORD = 'correct horse battery staple';

test.describe('@pwa install', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  /** What Chromium does once the app is installable: hands over a deferred install event. */
  async function offerInstall(page: Page, outcome: 'accepted' | 'dismissed' = 'accepted'): Promise<void> {
    await page.evaluate((choice) => {
      const event = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      const w = window as unknown as { __prompted?: number };
      event.prompt = async () => { w.__prompted = (w.__prompted ?? 0) + 1; };
      event.userChoice = Promise.resolve({ outcome: choice });
      window.dispatchEvent(event);
    }, outcome);
  }
  const prompted = (page: Page) => page.evaluate(() => (window as unknown as { __prompted?: number }).__prompted ?? 0);
  const installLink = (page: Page) => page.locator('a[href="/settings/install/"]');
  /** The Settings index (the list of groups), not Profile, which the shared `go(page, 'Settings')` helper opens. */
  const openSettingsIndex = async (page: Page) => {
    await page.locator('nav a[href="/settings/"]:visible').first().click();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  };

  test('is listed when the browser offers to install, in three steps, and Install shows the browser prompt', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await offerInstall(page);
    await openSettingsIndex(page); // step 1: open Settings
    await expect(installLink(page)).toBeVisible();
    await installLink(page).click(); // step 2: open the Install group
    await expect(page.getByRole('heading', { name: 'Install Cashfold', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Install Cashfold' }).click(); // step 3: press Install
    await expect.poll(() => prompted(page)).toBe(1);
    await expect(page.getByTestId('install-done')).toBeVisible();
    // The event can be used once: the button is gone.
    await expect(page.getByRole('button', { name: 'Install Cashfold' })).toHaveCount(0);
  });

  test('shows the one-line confirmation when the browser says the app was installed', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await offerInstall(page);
    await openSettingsIndex(page);
    await installLink(page).click();
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect(page.getByTestId('install-done')).toBeVisible();
  });

  test('is not listed when the browser cannot install, and a typed address goes back to Settings', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await openSettingsIndex(page);
    await page.waitForTimeout(2_500); // longer than the wait for the browser's install event
    await expect(installLink(page)).toHaveCount(0);
    await page.goto('/settings/install/');
    await unlock(page, PASSWORD);
    await expect(page).toHaveURL(/\/settings\/$/, { timeout: 30_000 });
  });

  test('is not listed in an installed window, even when the browser offers an install event', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    await signUpAndEnter(page);
    await offerInstall(page);
    await openSettingsIndex(page);
    await page.waitForTimeout(500);
    await expect(installLink(page)).toHaveCount(0);
  });

  test('never advertises installing on its own: no banner, toast or dialog on any screen', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await offerInstall(page);
    for (const screen of ['Overview', 'Transactions', 'Accounts', 'Plan']) {
      await go(page, screen);
      await page.waitForTimeout(300);
      await expect(page.getByText(/install cashfold/i)).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    expect(await prompted(page)).toBe(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the install section has no accessibility violations (${scheme} theme)`, async ({ page, expectNoA11yViolations }) => {
      test.setTimeout(240_000);
      await page.emulateMedia({ colorScheme: scheme });
      await signUpAndEnter(page);
      await offerInstall(page);
      await openSettingsIndex(page);
      await installLink(page).click();
      await expect(page.getByRole('button', { name: 'Install Cashfold' })).toBeVisible();
      await expectNoA11yViolations();
    });
  }

  test('a shortcut address of the icon asks for the password first and opens the action after unlocking', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await page.goto('/transactions/?new=expense');
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('tx-row')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await unlock(page, PASSWORD);
    await expect(page.getByRole('dialog', { name: 'Add transaction' }).getByRole('heading', { name: 'Add transaction' })).toBeVisible({ timeout: 60_000 });
  });

  test('the first screen of the app is dark under a dark system, and follows a light choice under it', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => {
      const w = window as unknown as { __firstFrame?: { theme: string | undefined; background: string } };
      requestAnimationFrame(() => { w.__firstFrame = { theme: document.documentElement.dataset['theme'], background: getComputedStyle(document.documentElement).backgroundColor }; });
    });
    await page.goto('/sign-in/');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __firstFrame?: unknown }).__firstFrame)).toEqual({ theme: 'dark', background: 'rgb(9, 9, 11)' });
    await page.evaluate(() => localStorage.setItem('cashfold.ui', JSON.stringify({ v: 1, theme: 'light' })));
    await page.reload();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __firstFrame?: unknown }).__firstFrame)).toEqual({ theme: 'light', background: 'rgb(255, 255, 255)' });
  });

  for (const [granted, wording] of [[true, 'has agreed to keep'], [false, 'has not agreed to keep']] as const) {
    test(`Settings says so when the browser ${granted ? 'agrees' : 'refuses'} to keep the data, and installing asks again`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.addInitScript((answer) => {
        const calls = { persist: 0 };
        (window as unknown as { __persistCalls: typeof calls }).__persistCalls = calls;
        Object.defineProperty(navigator.storage, 'persisted', { value: async () => answer });
        Object.defineProperty(navigator.storage, 'persist', { value: async () => { calls.persist++; return answer; } });
      }, granted);
      await signUpAndEnter(page);
      await go(page, 'Data');
      await expect(page.getByTestId('storage-state')).toContainText(wording);
      // Installing asks the browser again (FR-012): the answer is read where it is shown.
      const before = await page.evaluate(() => (window as unknown as { __persistCalls: { persist: number } }).__persistCalls.persist);
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
      if (!granted) await expect.poll(() => page.evaluate(() => (window as unknown as { __persistCalls: { persist: number } }).__persistCalls.persist)).toBeGreaterThan(before);
    });
  }
});
