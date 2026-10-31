import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { createAccount, go, lock, signUpAndEnter, unlock } from './fixtures/nav.js';

// The Privacy mode switch (spec 017): an always-present control in the sidebar footer (and the drawer) and a compact one in the narrow top bar, showing
// both states in words and an icon, flipping the one preference the Settings switch, the key and the palette also flip.

const PASSWORD = 'correct horse battery staple';
const MASK = '[data-privacy-mask]';
const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 390, height: 800 };

test.beforeEach(({ browserName }) => {
  test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
});

const sidebar = (page: Page): Locator => page.locator('[data-testid="privacy-switch"]:visible');
const topbar = (page: Page): Locator => page.getByTestId('privacy-switch-topbar');
const status = (page: Page): Locator => page.locator('[role="status"]', { hasText: /Privacy mode (on|off)/ });

async function shortcut(page: Page): Promise<string> {
  const apple = await page.evaluate(() => /mac|iphone|ipad|ipod/i.test((navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform));
  return apple ? 'Meta+Shift+M' : 'Control+Shift+M';
}

async function openDrawer(page: Page): Promise<void> {
  await page.locator('header button:visible').first().click();
  await expect(sidebar(page)).toBeVisible();
}

const noSideways = async (page: Page): Promise<void> => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
};

test.describe('@ux privacy switch', () => {
  test.setTimeout(300_000);

  test('is on every main screen in a wide window, shows both states, masks and unmasks with one press and keeps focus (user stories 1 and 2)', async ({ page }) => {
    await page.setViewportSize(WIDE);
    await signUpAndEnter(page);
    await createAccount(page, 'Checking', '1234.56');

    for (const screen of ['Overview', 'Accounts', 'Transactions', 'Plan', 'Settings']) {
      await go(page, screen);
      await expect(sidebar(page)).toHaveText('Privacy mode: off');
    }
    // Help and Lock keep their place under it.
    await go(page, 'Accounts');
    const items = await page.locator('nav [data-slot="section"]').last().locator('button').allTextContents();
    expect(items.map((s) => s.trim())).toEqual(['Privacy mode: off', 'Help', 'Lock']);
    await expect(topbar(page)).toBeHidden();

    const control = sidebar(page);
    await expect(control).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('account-balance').first()).toContainText(/\d[.,]\d{2} USD/);
    await control.click();
    await expect(page.getByTestId('account-balance').first().locator(MASK)).toHaveCount(1);
    await expect(control).toHaveText('Privacy mode: on');
    await expect(control).toHaveAttribute('aria-pressed', 'true');
    await expect(control).toBeFocused();
    await expect(page.getByText('Help', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible();

    await control.click();
    await expect(control).toHaveText('Privacy mode: off');
    await expect(page.getByTestId('account-balance').first().locator(MASK)).toHaveCount(0);

    // Quick presses end where the count says: three presses leave it on.
    await control.click();
    await control.click();
    await control.click();
    await expect(control).toHaveText('Privacy mode: on');

    // A revealed amount is masked again by the press.
    await page.getByRole('button', { name: /^Hidden amount/ }).first().click();
    await expect(page.getByTestId('account-balance').first()).toContainText(/\d[.,]\d{2} USD/);
    await control.click();
    await control.click();
    await expect(page.getByTestId('account-balance').first().locator(MASK)).toHaveCount(1);
  });

  test('is a button in the top bar of a narrow window and in the drawer, and both agree (user story 1)', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await signUpAndEnter(page);
    await createAccount(page, 'Checking', '1234.56');
    await go(page, 'Accounts');

    await expect(topbar(page)).toBeVisible();
    await expect(topbar(page)).toHaveAccessibleName('Privacy mode: off');
    await topbar(page).click();
    await expect(page.getByTestId('account-balance').first().locator(MASK)).toHaveCount(1);
    await expect(topbar(page)).toHaveAccessibleName('Privacy mode: on');
    await expect(topbar(page)).toHaveAttribute('aria-pressed', 'true');

    await openDrawer(page);
    await expect(sidebar(page)).toHaveText('Privacy mode: on');
    await sidebar(page).click();
    await expect(sidebar(page)).toHaveText('Privacy mode: off'); // the drawer stays open
    await expect(topbar(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible();
    await noSideways(page);
  });

  test('is a top-bar button below the large breakpoint and not at it', async ({ page }) => {
    await signUpAndEnter(page);
    await page.setViewportSize({ width: 1023, height: 800 });
    await expect(topbar(page)).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(topbar(page)).toBeHidden();
    await expect(sidebar(page)).toBeVisible();
  });

  test('keeps Help, Lock, the sync status and the schedule badge at a larger text size (FR-012)', async ({ page }) => {
    await signUpAndEnter(page);
    for (const size of [WIDE, NARROW]) {
      await page.setViewportSize(size);
      await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
      if (size === NARROW) await openDrawer(page);
      await expect(sidebar(page)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible();
      await expect(page.locator('nav').getByRole('button', { name: 'Help' })).toBeVisible();
      await expect(page.locator('nav a[href="/settings/sync/"]:visible').first()).toBeVisible();
      await noSideways(page);
      if (size === NARROW) await page.keyboard.press('Escape');
    }
  });

  test('says the change politely, whichever route made it (user story 2)', async ({ page }) => {
    await page.setViewportSize(WIDE);
    await signUpAndEnter(page);
    await go(page, 'Overview');
    const key = await shortcut(page);

    await sidebar(page).click();
    await expect(status(page)).toHaveText('Privacy mode on');
    await page.keyboard.press(key);
    await expect(status(page)).toHaveText('Privacy mode off');
    await go(page, 'Appearance');
    await page.getByTestId('privacy-mode-switch').click();
    await expect(status(page)).toHaveText('Privacy mode on');
  });

  test('every route changes the mode and the switch follows, and it changes the Settings switch too (user story 3)', async ({ page }) => {
    await page.setViewportSize(WIDE);
    await signUpAndEnter(page);
    const key = await shortcut(page);

    await go(page, 'Appearance');
    await page.getByTestId('privacy-mode-switch').click();
    await expect(sidebar(page)).toHaveText('Privacy mode: on');
    await page.keyboard.press(key);
    await expect(sidebar(page)).toHaveText('Privacy mode: off');

    await page.keyboard.press(key);
    await expect(sidebar(page)).toHaveText('Privacy mode: on');
    await page.keyboard.press(apple(await shortcut(page)) ? 'Meta+K' : 'Control+K');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByRole('combobox').fill('Turn privacy mode off');
    await page.keyboard.press('Enter');
    await expect(sidebar(page)).toHaveText('Privacy mode: off');

    await sidebar(page).click();
    await expect(page.getByTestId('privacy-mode-switch')).toHaveAttribute('aria-checked', 'true');

    // Exactly one in the page, none in the top bar.
    await expect(page.locator('[data-testid="privacy-switch"]')).toHaveCount(1);
    await expect(topbar(page)).toBeHidden();

    // Locked: neither is on the lock screen, and it is back as it was when unlocked.
    await lock(page);
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
    await expect(page.locator('[data-testid^="privacy-switch"]')).toHaveCount(0);
    await unlock(page, PASSWORD);
    await expect(sidebar(page)).toHaveText('Privacy mode: on');
  });

  test('has one switch in the drawer and one in the top bar, in the same state', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await signUpAndEnter(page);
    await openDrawer(page);
    await expect(page.locator('[data-testid="privacy-switch"]:visible')).toHaveCount(1);
    await expect(topbar(page)).toHaveCount(1);
    await sidebar(page).click();
    await expect(topbar(page)).toHaveAttribute('aria-pressed', 'true');
  });

  for (const [locale, off] of [['uk', 'Режим приватності: вимкнено'], ['pl', 'Tryb prywatności: wyłączony']] as const) {
    test.describe(`in ${locale}`, () => {
      test.use({ locale });
      test('the control is in the language and does not overflow', async ({ page }) => {
        await page.setViewportSize(NARROW);
        await signUpAndEnter(page);
        await openDrawer(page);
        await expect(sidebar(page)).toContainText(off);
        await noSideways(page);
      });
    });
  }
});

const apple = (key: string): boolean => key.startsWith('Meta');
