import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go, moreDetails } from './fixtures/nav.js';

// User story 5: envelope budgets with rollover (FR-054 to FR-061), offline.
// The scenario runs against the device clock: the budget starts at the first day of last month, so "month one" is
// last month and "month two" is the current one, whatever day the test runs on.

const PASSWORD = 'correct horse battery staple';

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const FIRST_OF_LAST_MONTH = `${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}-01`;
const TENTH_OF_LAST_MONTH = `${FIRST_OF_LAST_MONTH.slice(0, 8)}10T12:00`;

test.describe('@us5 budgets', () => {
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
    await moreDetails(dialog);
    await dialog.getByLabel('Opening date').fill('2020-01-01');
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  async function spendLastMonth(page: Page, amount: string, note: string): Promise<void> {
    await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount (USD)').fill(amount);
    await dialog.getByLabel('Date and time').fill(TENTH_OF_LAST_MONTH);
    await moreDetails(dialog);
    await dialog.getByLabel('Note').fill(note);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  async function addBudget(page: Page, name: string, rollover: string): Promise<void> {
    await page.getByRole('button', { name: 'Add budget', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByLabel('Starting on').fill(FIRST_OF_LAST_MONTH);
    await dialog.getByLabel('Limit (USD)').fill('300.00');
    await dialog.getByLabel('What is left over').selectOption({ label: rollover });
    await dialog.getByRole('button', { name: 'Create budget' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  const figure = (page: Page, name: string) => page.getByTestId('budget-row').filter({ hasText: name }).getByTestId('budget-figure');

  test('carries what is left over (or not) into the next period, recomputes when the policy changes, and works offline', async ({ page, context, expectNoA11yViolations }) => {
    await intoApp(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await context.setOffline(true);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();

    await go(page, 'Accounts');
    await addAccount(page, 'Everyday', '1000.00');
    await go(page, 'Transactions');
    await spendLastMonth(page, '120.00', 'Weekly shop');

    // --- carry positive: 300.00 limit, 120.00 spent last month ⇒ 480.00 available this month
    await go(page, 'Budgets');
    await expect(page.getByRole('heading', { level: 1, name: 'Budgets' })).toBeVisible();
    await addBudget(page, 'Groceries', 'Carry over what is left');
    await expect(figure(page, 'Groceries')).toHaveText('480.00 USD');
    await expectNoA11yViolations();

    // --- the detail shows how the number is made
    await page.getByRole('button', { name: 'Groceries', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('budget-carry-in')).toHaveText('180.00 USD');
    await expect(dialog.getByTestId('budget-allocation')).toHaveText('300.00 USD');
    await expect(dialog.getByTestId('budget-spent')).toHaveText('0.00 USD');
    await expect(dialog.getByTestId('budget-available')).toHaveText('480.00 USD');
    await dialog.getByRole('button', { name: 'Close' }).click();

    // --- no rollover: 300.00
    await addBudget(page, 'Fresh start', 'Starts fresh each period');
    await expect(figure(page, 'Fresh start')).toHaveText('300.00 USD');

    // --- changing the policy recomputes from the same transactions
    await page.getByRole('button', { name: 'Edit Fresh start' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('What is left over').selectOption({ label: 'Carry over what is left' });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(figure(page, 'Fresh start')).toHaveText('480.00 USD');

    // --- carry all after an overspend: 400.00 spent last month ⇒ 200.00 this month
    await go(page, 'Transactions');
    await spendLastMonth(page, '280.00', 'Party');
    await go(page, 'Budgets');
    await addBudget(page, 'Strict', 'Carry over what is left and what is overspent');
    await expect(figure(page, 'Strict')).toHaveText('200.00 USD');

    // --- everything survives a reload
    await page.reload();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await go(page, 'Budgets');
    await expect(figure(page, 'Strict')).toHaveText('200.00 USD');
    await expect(page.getByTestId('budget-row')).toHaveCount(3);
  });
});
