import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go, moreDetails, cancelAdd } from './fixtures/nav.js';

// User story 3: move money between accounts and currencies (FR-043 to FR-046), offline.

const PASSWORD = 'correct horse battery staple';

test.describe('@us3 transfers', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  async function intoApp(page: Page): Promise<void> {
    await page.goto('/sign-up/');
    await page.getByLabel('Email address', { exact: true }).fill('alice@example.com');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByLabel('Service address').fill('https://relay.example.com');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('current-fold')).toHaveText('Personal');
  }


  async function addAccount(page: Page, name: string, opening: string, opts: { currency?: string; kind?: string } = {}): Promise<void> {
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    if (opts.kind) await dialog.getByLabel('Kind').selectOption({ label: opts.kind });
    if (opts.currency) await dialog.getByLabel('Currency').selectOption(opts.currency);
    await dialog.getByLabel(/^Opening balance/).fill(opening);
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  }

  /** The Overview keeps its two counting options under "Options"; this opens them when needed and sets the transfers switch. */
  async function countTransfers(page: Page, on: boolean): Promise<void> {
    const toggle = page.getByRole('button', { name: /^Options/ });
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    const sw = page.getByLabel('Count transfers as income and expenses');
    if (on) await sw.check();
    else await sw.uncheck();
  }

  const balanceOf = (page: Page, account: string) => page.getByTestId('account-row').filter({ hasText: account }).getByTestId('account-balance');

  async function transfer(page: Page, from: string, to: string, out: string, arriving?: string) {
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Transfer' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('From account').selectOption({ label: from });
    await dialog.getByLabel('To account').selectOption({ label: to });
    await dialog.getByLabel(/^Amount leaving/).fill(out);
    if (arriving !== undefined) await dialog.getByLabel(/^Amount arriving/).fill(arriving);
    return dialog;
  }

  test('moves money across currencies exactly, edits and deletes both sides together, and keeps transfers out of income and expenses unless asked', async ({ page, context, expectNoA11yViolations }) => {
    test.setTimeout(120_000);
    await intoApp(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await context.setOffline(true);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();

    await go(page, 'Accounts');
    await addAccount(page, 'Everyday', '1000.00');
    await addAccount(page, 'Euro wallet', '0', { currency: 'EUR' });
    await addAccount(page, 'Holiday fund', '0', { kind: 'Goal' });

    // --- USD 100.00 becomes EUR 91.37, exactly as entered
    await go(page, 'Transfers');
    let dialog = await transfer(page, 'Everyday (USD)', 'Euro wallet (EUR)', '100.00', '91.37');
    await expectNoA11yViolations();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const row = page.getByTestId('xfer-row');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('xfer-out')).toHaveText('−100.00 USD');
    await expect(row.getByTestId('xfer-in')).toHaveText('+91.37 EUR');
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText('900.00 USD');
    await expect(balanceOf(page, 'Euro wallet')).toHaveText('91.37 EUR');

    // --- the same account on both sides is refused
    await go(page, 'Transfers');
    dialog = await transfer(page, 'Everyday (USD)', 'Everyday (USD)', '5.00');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toContainText('two different accounts');
    await cancelAdd(page, dialog);
    await expect(page.getByTestId('xfer-row')).toHaveCount(1);

    // --- same currency mirrors the amount
    dialog = await transfer(page, 'Everyday (USD)', 'Holiday fund (USD)', '50.00');
    await expect(dialog.getByTestId('mirrored')).toBeVisible();
    await expect(dialog.getByLabel(/^Amount arriving/)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('xfer-row')).toHaveCount(2);

    // --- edit changes both sides together
    await page.getByRole('button', { name: 'Edit Everyday → Euro wallet' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Amount leaving/).fill('80.00');
    await dialog.getByLabel(/^Amount arriving/).fill('73.10');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText('870.00 USD');
    await expect(balanceOf(page, 'Euro wallet')).toHaveText('73.10 EUR');
    await expect(balanceOf(page, 'Holiday fund')).toHaveText('50.00 USD');

    // --- delete asks first, removes both sides, and restore brings both back
    await go(page, 'Transfers');
    await page.getByRole('button', { name: 'Delete Everyday → Euro wallet' }).click();
    await expect(page.getByRole('dialog')).toContainText('Both sides are removed together');
    await expectNoA11yViolations();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete transfer' }).click();
    await expect(page.getByTestId('xfer-row')).toHaveCount(1);
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText('950.00 USD');
    await expect(balanceOf(page, 'Euro wallet')).toHaveText('0.00 EUR');
    await go(page, 'Transfers');
    await page.getByTestId('xfer-deleted').getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByTestId('xfer-row')).toHaveCount(2);
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText('870.00 USD');
    await expect(balanceOf(page, 'Euro wallet')).toHaveText('73.10 EUR');

    // --- a goal account takes transfers, but not plain income
    await go(page, 'Transactions');
    await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Income' }).click();
    await dialog.getByLabel('Account').selectOption({ label: 'Holiday fund (USD)' });
    await dialog.getByLabel('Amount (USD)').fill('10.00');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toContainText('goal takes only transfers');
    await cancelAdd(page, dialog);

    // --- dashboard: transfers stay out of income and expenses unless asked, and then need a rate
    await go(page, 'Dashboard');
    await expect(page.getByTestId('expense')).toHaveText('0.00 USD');
    await expect(page.getByTestId('income')).toHaveText('0.00 USD');
    await countTransfers(page, true);
    await expect(page.getByText('Missing exchange rates for EUR')).toBeVisible();
    await expect(page.getByTestId('expense')).toHaveText('130.00 USD'); // 80.00 to the Euro wallet + 50.00 to the goal
    await expectNoA11yViolations();

    await go(page, 'Transfers');
    await page.getByLabel('Rate for EUR').fill('0.9137');
    await page.getByRole('button', { name: 'Save rate' }).click();
    await expect(page.getByTestId('rate-list')).toContainText('0.9137');
    await go(page, 'Dashboard');
    await countTransfers(page, true);
    await expect(page.getByTestId('income')).toHaveText('130.00 USD'); // 73.10 EUR / 0.9137 = 80.00, plus the 50.00 that arrives in the goal
    await expect(page.getByTestId('expense')).toHaveText('130.00 USD');
    await expect(page.getByTestId('net')).toHaveText('0.00 USD');
    await countTransfers(page, false);
    await expect(page.getByTestId('expense')).toHaveText('0.00 USD');

    // --- re-valuing past transactions says what it did
    await go(page, 'Transfers');
    await page.getByRole('button', { name: 'Re-value transactions' }).click();
    await page.getByRole('button', { name: 'Re-value now' }).click();
    await expect(page.getByTestId('revalue-summary')).toContainText('No transaction changed');
  });

  test('suggests the destination amount from a rate only when asked, and never overwrites what was typed', async ({ page }) => {
    await intoApp(page);
    await go(page, 'Accounts');
    await addAccount(page, 'Everyday', '1000.00');
    await addAccount(page, 'Euro wallet', '0', { currency: 'EUR' });
    await go(page, 'Transfers');
    await page.getByLabel('Rate for EUR').fill('0.9137');
    await page.getByRole('button', { name: 'Save rate' }).click();
    await expect(page.getByTestId('rate-list')).toContainText('0.9137');

    const dialog = await transfer(page, 'Everyday (USD)', 'Euro wallet (EUR)', '100.00');
    await expect(dialog.getByLabel(/^Amount arriving/)).toHaveValue('');
    await dialog.getByRole('button', { name: 'Suggest from exchange rate' }).click();
    await expect(dialog.getByLabel(/^Amount arriving/)).toHaveValue('91.37');
    await expect(dialog.getByTestId('rate-used')).toBeVisible();
    await dialog.getByLabel(/^Amount arriving/).fill('91.00'); // the person's own number wins
    await expect(dialog.getByTestId('implied-rate')).toContainText('0.91');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('xfer-row').getByTestId('xfer-in')).toHaveText('+91.00 EUR');
  });

  test('leaves no account name, note or amount in readable form anywhere', async ({ page, leakScan }) => {
    const capture = leakScan.begin();
    await intoApp(page);
    await go(page, 'Accounts');
    await addAccount(page, 'Narwhal Savings', '777.77');
    await addAccount(page, 'Walrus Wallet', '0', { currency: 'EUR' });
    await go(page, 'Transfers');
    const dialog = await transfer(page, 'Narwhal Savings (USD)', 'Walrus Wallet (EUR)', '321.45', '293.71');
    await moreDetails(dialog);
    await dialog.getByLabel('Note').fill('Tusk repairs');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('xfer-row')).toHaveCount(1);
    await leakScan.expectNoLeaks({ strings: ['Narwhal Savings', 'Walrus Wallet', 'Tusk repairs', PASSWORD], amounts: ['321.45', '32145', '293.71', '29371', '777.77', '77777'] }, capture);
  });
});
