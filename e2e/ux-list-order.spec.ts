import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go } from './fixtures/nav.js';
import { chooseAccount } from './fixtures/select.js';

// Entries made within the same minute are listed newest first, in the order they were made.

const PASSWORD = 'correct horse battery staple';

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

async function addAccount(page: Page, name: string, opening: string): Promise<void> {
  await go(page, 'Accounts');
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel(/Opening balance/).fill(opening);
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('@ux list order', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  test('lists entries made in the same minute newest first, transfers and transactions alike', async ({ page }) => {
    test.setTimeout(240_000);
    await intoApp(page);
    await addAccount(page, 'Everyday', '1000.00');
    await addAccount(page, 'Savings', '0.00');
    await go(page, 'Transactions');

    for (const [note, amount] of [['First', '1.00'], ['Second', '2.00'], ['Third', '3.00']] as const) {
      await page.getByRole('button', { name: 'Add', exact: true }).first().click();
      const sheet = page.getByRole('dialog');
      await chooseAccount(sheet.getByLabel('Account'), 'Everyday');
      await sheet.getByLabel(/^Amount/).fill(amount);
      // The sheet remembers More details open from the last time.
      const more = sheet.getByRole('button', { name: 'More details' });
      if ((await more.getAttribute('aria-expanded')) === 'false') await more.click();
      await sheet.getByLabel('Note').fill(note);
      await sheet.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByTestId('tx-row').filter({ hasText: note })).toHaveCount(1);
    }
    await expect(page.getByTestId('tx-row')).toHaveText([/Third/, /Second/, /First/]);

    for (const amount of ['100.00', '170.00']) {
      await page.getByRole('button', { name: 'Add', exact: true }).first().click();
      await page.getByRole('tab', { name: 'Transfer' }).click();
      const dialog = page.getByRole('dialog');
      await chooseAccount(dialog.getByLabel('From account'), 'Everyday');
      await chooseAccount(dialog.getByLabel('To account'), 'Savings');
      await dialog.getByLabel(/^Amount leaving/).fill(amount);
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    // Every entry carries the same minute here or a later one: the transfers made last lead, 170 before 100, then the transactions.
    const rows = page.getByTestId('tx-row').or(page.getByTestId('xfer-row'));
    await expect(rows.nth(0)).toContainText('170.00');
    await expect(rows.nth(1)).toContainText('100.00');
  });
});
