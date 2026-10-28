import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go, moreDetails, openAddTransaction } from './fixtures/nav.js';

// Direction and number formatting (FR-095). The `rtl` project runs this under an Arabic browser locale: the layout mirrors with logical
// properties, and amounts stay exact (bigint minor units, Latin digits, never a floating-point number), even beyond 2^53.

const PASSWORD = 'correct horse battery staple';
const BEYOND_2_53 = '90071992547409.93'; // 9,007,199,254,740,993 minor units: one more than a double can hold exactly

test.describe('@i18n direction and formatting', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  async function intoApp(page: Page): Promise<void> {
    await page.goto('/sign-up/');
    await page.getByLabel('Email address', { exact: true }).fill('alice@example.com');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByLabel('Keep everything on this device for now').uncheck();
    await page.getByLabel('Service address').fill('https://relay.example.com');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('current-fold')).toHaveText('Personal');
  }


  test('the layout follows the direction of the language on every screen', async ({ page }, info) => {
    const rtl = info.project.name === 'rtl';
    await intoApp(page);
    await expect(page.locator('html')).toHaveAttribute('dir', rtl ? 'rtl' : 'ltr');
    for (const screen of ['Dashboard', 'Accounts', 'Transactions', 'Budgets', 'Settings']) {
      await go(page, screen);
      // Nothing is cut off at either edge, and the page never scrolls sideways.
      const { overflow, direction } = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        direction: getComputedStyle(document.body).direction,
      }));
      expect(overflow, `${screen} scrolls sideways`).toBeLessThanOrEqual(1);
      expect(direction).toBe(rtl ? 'rtl' : 'ltr');
    }
    // The Lock button sits in the sidebar, at the inline start: left in LTR, right in RTL.
    const lock = await page.getByRole('button', { name: 'Lock', exact: true }).boundingBox();
    const width = page.viewportSize()!.width;
    const centre = lock!.x + lock!.width / 2;
    if (rtl) expect(centre).toBeGreaterThan(width / 2);
    else expect(centre).toBeLessThan(width / 2);
  });

  test('a dialog mirrors, and its fields keep left-to-right content where it must', async ({ page }, info) => {
    const rtl = info.project.name === 'rtl';
    await intoApp(page);
    await go(page, 'Accounts');
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible();
    expect(await dialog.evaluate((d) => getComputedStyle(d).direction)).toBe(rtl ? 'rtl' : 'ltr');
    const label = await dialog.getByText('Name', { exact: true }).first().boundingBox();
    const box = await dialog.boundingBox();
    // Labels start at the inline start edge of the dialog.
    if (rtl) expect(label!.x + label!.width).toBeGreaterThan(box!.x + box!.width / 2);
    else expect(label!.x).toBeLessThan(box!.x + box!.width / 2);
    await page.keyboard.press('Escape');
  });

  test('amounts are exact, with Latin digits, even beyond what a double can hold', async ({ page }) => {
    await intoApp(page);
    await go(page, 'Accounts');
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill('Vault');
    await dialog.getByLabel('Opening balance (USD)').fill(BEYOND_2_53);
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const balance = page.getByTestId('account-row').filter({ hasText: 'Vault' }).getByTestId('account-balance');
    // 9007199254740993 cents. A double would print ...992.
    await expect(balance).toHaveText('90,071,992,547,409.93 USD');
    await expect(balance).not.toContainText(/[٠-٩]/);

    // Adding to it stays exact.
    await go(page, 'Transactions');
    await openAddTransaction(page);
    const tx = page.getByRole('dialog');
    await tx.getByLabel('Account').selectOption({ label: 'Vault (USD)' });
    await tx.getByLabel('Amount (USD)').fill('0.01');
    await moreDetails(tx);
    await tx.getByLabel('Note').fill('One cent');
    await tx.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await go(page, 'Accounts');
    await expect(page.getByTestId('account-row').filter({ hasText: 'Vault' }).getByTestId('account-balance')).toHaveText('90,071,992,547,409.92 USD');
  });
});
