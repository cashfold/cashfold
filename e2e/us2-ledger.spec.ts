import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go, moreDetails, cancelAdd, openRowAction, toggleRecentlyDeleted, editRow, accountAction, unlock, openAddTransaction } from './fixtures/nav.js';

// User story 2: accounts, categories and transactions, entirely offline (FR-023 to FR-036, FR-051, FR-072).
// Runs on the production build with the real encrypted database. The network goes away after the app has loaded.

const PASSWORD = 'correct horse battery staple';
const EXPENSES = ['4.50', '12.50', '7.99', '50.00', '1.01', '29.99', '15.00', '3.33', '42.00', '0.12'];

/** Cents as the app prints them: 1,234.56 USD. */
function fmt(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${whole}.${(abs % 100n).toString().padStart(2, '0')} USD`;
}
const cents = (text: string): bigint => BigInt(text.replace('.', ''));

test.describe('@us2 ledger', () => {
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


  async function addAccount(page: Page, name: string, opening: string): Promise<void> {
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByLabel('Opening balance (USD)').fill(opening);
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  }

  async function addExpense(page: Page, account: string, amount: string, note: string): Promise<void> {
    await openAddTransaction(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Account').selectOption({ label: `${account} (USD)` });
    await dialog.getByLabel('Amount (USD)').fill(amount);
    await moreDetails(dialog);
    await dialog.getByLabel('Note').fill(note);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('tx-row').filter({ hasText: note })).toHaveCount(1);
  }

  const balanceOf = (page: Page, account: string) => page.getByTestId('account-row').filter({ hasText: account }).getByTestId('account-balance');

  test('records, edits, deletes and restores transactions offline with exact balances, and keeps them after a reload', async ({ page, context, expectNoA11yViolations }) => {
    await intoApp(page);
    // Let the service worker install, then lose the network for the rest of the story.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await context.setOffline(true);
    await unlock(page, PASSWORD);
    await expect(page.getByTestId('current-fold')).toHaveText('Personal');

    // --- accounts
    await go(page, 'Accounts');
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
    await expect(page.getByText('You have no accounts yet')).toBeVisible();
    await addAccount(page, 'Everyday', '1,000.00');
    await addAccount(page, 'Rainy day', '250.00');
    await expect(balanceOf(page, 'Everyday')).toHaveText(fmt(100_000n));
    await expect(balanceOf(page, 'Rainy day')).toHaveText(fmt(25_000n));
    await expectNoA11yViolations();

    // --- ten transactions
    await go(page, 'Transactions');
    await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();
    for (const [i, amount] of EXPENSES.entries()) await addExpense(page, 'Everyday', amount, `Spend ${i + 1}`);
    await expect(page.getByTestId('tx-count')).toHaveText('10 transactions');
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Spend 4' }).getByTestId('tx-amount')).toHaveText('−50.00 USD');
    let expected = 100_000n - EXPENSES.reduce((sum, a) => sum + cents(a), 0n);

    // --- too many decimals is rejected, never rounded
    await openAddTransaction(page);
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount (USD)').fill('1.234');
    await expect(dialog.getByText('USD has 2 decimal places')).toBeVisible();
    await moreDetails(dialog);
    await dialog.getByLabel('Note').fill('Should not exist');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert').first()).toBeVisible();
    await expectNoA11yViolations();
    await cancelAdd(page, dialog);
    await expect(page.getByText('Should not exist')).toHaveCount(0);

    // --- edit
    await editRow(page, 'Spend 2').click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('last-changed')).toContainText('this device');
    await dialog.getByLabel('Amount (USD)').fill('20.00');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Spend 2' }).getByTestId('tx-amount')).toHaveText('−20.00 USD');
    expected += cents('12.50') - cents('20.00');

    // --- delete needs a confirmation, restore brings it back
    await openRowAction(page, 'Spend 3', 'Delete');
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('moves to Recently deleted');
    await expectNoA11yViolations();
    await cancelAdd(page, dialog);
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Spend 3' })).toHaveCount(1); // cancelling changed nothing
    await openRowAction(page, 'Spend 3', 'Delete');
    await page.getByRole('dialog').getByRole('button', { name: 'Delete transaction' }).click();
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Spend 3' })).toHaveCount(0);
    await toggleRecentlyDeleted(page);
    await expect(page.getByTestId('deleted-list')).toContainText('Spend 3');
    await expect(page.getByTestId('deleted-list')).toContainText('30 days left');
    expected += cents('7.99');

    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText(fmt(expected));
    await go(page, 'Transactions');
    await toggleRecentlyDeleted(page);
    await page.getByTestId('deleted-list').getByRole('button', { name: /^Restore/ }).click();
    await toggleRecentlyDeleted(page);
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Spend 3' })).toHaveCount(1);
    expected -= cents('7.99');

    // --- a very large amount stays exact (more than 2^53 minor units)
    await openAddTransaction(page);
    dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Income' }).click();
    await dialog.getByLabel('Account').selectOption({ label: 'Everyday (USD)' });
    await dialog.getByLabel('Amount (USD)').fill('90071992547409.93');
    await moreDetails(dialog);
    await dialog.getByLabel('Note').fill('Windfall');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Windfall' })).toHaveCount(1);
    expected += 9_007_199_254_740_993n;

    // --- category, payee, a new tag and a place on one transaction
    await openAddTransaction(page);
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Account').selectOption({ label: 'Everyday (USD)' });
    await dialog.getByLabel('Amount (USD)').fill('8.00');
    await dialog.getByLabel('Category').fill('Groceries');
    await dialog.getByRole('option', { name: /Food & Drink › Groceries/ }).click();
    await moreDetails(dialog);
    await dialog.getByLabel('Payee').fill('Corner shop');
    await dialog.getByLabel(/^Tags/).fill('weekly');
    await dialog.getByLabel('Place name').fill('Corner shop, High Street');
    await dialog.getByRole('button', { name: 'Exact coordinates' }).click();
    await dialog.getByLabel('Latitude').fill('51.5074');
    await dialog.getByLabel('Longitude').fill('-0.1278');
    await dialog.getByLabel('Note').fill('Groceries run');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const run = page.getByTestId('tx-row').filter({ hasText: 'Groceries run' });
    await expect(run).toHaveCount(1);
    await expect(run).toContainText('Groceries');
    await expect(run).toContainText('Corner shop, High Street');
    expected -= cents('8.00');
    await editRow(page, 'Corner shop').click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Latitude')).toHaveValue('51.5074');
    await expect(dialog.getByLabel('Longitude')).toHaveValue('-0.1278');
    await expectNoA11yViolations();
    await cancelAdd(page, dialog);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Food & Drink › Groceries' });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('tx-count')).toHaveText('1 transaction');
    await page.getByTestId('filter-chips').getByRole('button', { name: 'Clear all' }).click();

    // --- search and filter work on the device
    await page.getByLabel('Search').fill('windfall');
    await expect(page.getByTestId('tx-count')).toHaveText('1 transaction');
    await page.getByLabel('Search').fill('');
    await expect(page.getByTestId('tx-count')).toHaveText('12 transactions');

    // --- archive hides an account
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText(fmt(expected));
    await accountAction(page, 'Rainy day', 'Archive');
    await expect(page.getByRole('link', { name: 'Rainy day', exact: true })).toHaveCount(0);
    await page.getByLabel('Show archived accounts').check();
    await expect(page.getByTestId('account-row').filter({ hasText: 'Rainy day' })).toContainText('Archived');
    await accountAction(page, 'Rainy day', 'Restore');
    await page.getByLabel('Show archived accounts').uncheck();
    await expect(page.getByRole('link', { name: 'Rainy day', exact: true })).toBeVisible();

    // --- the balance can be adjusted to an exact target
    await accountAction(page, 'Rainy day', 'Adjust balance');
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Balance should be (USD)').fill('300.00');
    await dialog.getByRole('button', { name: 'Adjust balance' }).click();
    await expect(balanceOf(page, 'Rainy day')).toHaveText(fmt(30_000n));

    // --- deleting an account says what goes with it, and needs a confirmation
    await accountAction(page, 'Rainy day', 'Delete');
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('This also deletes 1 transaction');
    await cancelAdd(page, dialog);
    await expect(page.getByRole('link', { name: 'Rainy day', exact: true })).toBeVisible();

    // --- dashboard
    await go(page, 'Dashboard');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByTestId('net-worth')).toHaveText(fmt(expected + 30_000n));
    await expect(page.getByTestId('expense')).toHaveText(fmt(EXPENSES.reduce((sum, a) => sum + cents(a), 0n) - cents('12.50') + cents('20.00') + cents('8.00')));
    await expectNoA11yViolations();

    // --- categories: the default set is there, a third level is refused
    await go(page, 'Categories');
    await expect(page.getByRole('heading', { level: 1, name: 'Categories' })).toBeVisible();
    await expect(page.getByTestId('category-root').filter({ hasText: 'Food & Drink' })).toHaveCount(1);
    await expect(page.getByTestId('category-child').filter({ hasText: 'Groceries' })).toContainText('used once');
    await page.getByRole('tab', { name: 'Payees' }).click();
    await expect(page.getByTestId('payee-row').filter({ hasText: 'Corner shop' })).toContainText('used once');
    await page.getByRole('tab', { name: 'Tags' }).click();
    await expect(page.getByTestId('tag-row').filter({ hasText: 'weekly' })).toContainText('used once');
    await page.getByRole('tab', { name: 'Expense' }).click();
    await expectNoA11yViolations();
    await page.getByRole('button', { name: 'Merge Home', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Merge into').selectOption({ label: 'Food & Drink › Groceries' });
    await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('at most two levels');
    await cancelAdd(page, dialog);

    // --- everything is still there after a reload while offline (the app starts locked)
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 30_000 });
    await unlock(page, PASSWORD);
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText(fmt(expected));
    await expect(balanceOf(page, 'Rainy day')).toHaveText(fmt(30_000n));
  });

  test('leaves no name, note or amount in readable form in any browser storage, console or network traffic', async ({ page, leakScan }) => {
    const capture = leakScan.begin();
    await intoApp(page);
    await go(page, 'Accounts');
    await addAccount(page, 'Quokka Savings', '4,321.09');
    await go(page, 'Transactions');
    await addExpense(page, 'Quokka Savings', '123.45', 'Marsupial supplies');
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Quokka Savings')).toHaveText(fmt(432_109n - 12_345n));
    await leakScan.expectNoLeaks({ strings: ['Quokka Savings', 'Marsupial supplies', PASSWORD], amounts: ['123.45', '12345', '4321.09', '432109'] }, capture);
  });
});
