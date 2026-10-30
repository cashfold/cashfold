import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go, moreDetails, openAddTransaction } from './fixtures/nav.js';
import { chooseAccount } from './fixtures/select.js';

// The strict Content-Security-Policy (no 'unsafe-inline', Trusted Types) must hold on every screen of the interface (FR-049, R-UX-03). The
// `cspGuard` fixture fails any test that sees a violation; this spec walks every route so a regression is caught where it is introduced.

const PASSWORD = 'correct horse battery staple';

test.describe('@csp no policy violations', () => {
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

  test('signing up, adding a transaction and visiting every route raises no violation', async ({ page }) => {
    test.setTimeout(240_000);
    await intoApp(page);
    await go(page, 'Accounts');
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    const account = page.getByRole('dialog');
    await account.getByLabel('Name', { exact: true }).fill('Everyday');
    await account.getByLabel('Opening balance (USD)').fill('100.00');
    await account.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await go(page, 'Transactions');
    await openAddTransaction(page);
    const tx = page.getByRole('dialog');
    await chooseAccount(tx.getByLabel('Account'), 'Everyday');
    await tx.getByLabel('Amount (USD)').fill('12.50');
    await moreDetails(tx);
    await tx.getByLabel('Note').fill('Coffee beans');
    await tx.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' })).toHaveCount(1);

    // The five sections, the Plan tabs and every Settings group.
    for (const name of ['Overview', 'Accounts', 'Transactions', 'Budgets', 'Goals', 'Schedules', 'Categories', 'Folds', 'Data', 'Devices', 'Settings']) {
      await go(page, name);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    }
  });
});
