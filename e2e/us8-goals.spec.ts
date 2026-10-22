import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go } from './fixtures/nav.js';

// User story 8: savings goals backed by goal accounts (FR-067, FR-068, FR-029), offline.

const PASSWORD = 'correct horse battery staple';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inAYear = (() => {
  const d = new Date();
  const day = d.getDate();
  d.setDate(1);
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return iso(d);
})();
const yesterday = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return iso(d);
})();

test.describe('@us8 goals', () => {
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


  async function addAccount(page: Page, name: string, opening: string, kind?: string): Promise<void> {
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    if (kind) await dialog.getByLabel('Kind').selectOption({ label: kind });
    await dialog.getByLabel(/^Opening balance/).fill(opening);
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  async function moveIn(page: Page, to: string, amount: string): Promise<void> {
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Transfer' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('From account').selectOption({ label: 'Everyday (USD)' });
    await dialog.getByLabel('To account').selectOption({ label: `${to} (USD)` });
    await dialog.getByLabel(/^Amount leaving/).fill(amount);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  async function addGoal(page: Page, name: string, account: string, target: string, date: string): Promise<void> {
    await page.getByRole('button', { name: 'Add goal', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByLabel('Goal account').selectOption({ label: `${account} (USD)` });
    await dialog.getByLabel('Target (USD)').fill(target);
    await dialog.getByLabel('Target date').fill(date);
    await dialog.getByRole('button', { name: 'Create goal' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  const row = (page: Page, name: string) => page.getByTestId('goal-row').filter({ hasText: name });

  test('shows saved, remaining, percent and the exact monthly saving, and reaches achieved and overdue', async ({ page, context, expectNoA11yViolations }) => {
    await intoApp(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await context.setOffline(true);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();

    await go(page, 'Goals');
    await expect(page.getByTestId('goals-need-account')).toBeVisible();

    await go(page, 'Accounts');
    await addAccount(page, 'Everyday', '9000.00');
    await addAccount(page, 'Holiday fund', '0', 'Goal');
    await addAccount(page, 'Car fund', '0', 'Goal');

    // --- 6,000.00 due in twelve months
    await go(page, 'Goals');
    await addGoal(page, 'Holiday', 'Holiday fund', '6000.00', inAYear);
    await expect(row(page, 'Holiday').getByTestId('goal-saved')).toHaveText('0.00 USD');
    await expect(row(page, 'Holiday').getByTestId('goal-remaining')).toHaveText('6,000.00 USD');
    await expect(row(page, 'Holiday').getByTestId('goal-monthly')).toHaveText('500.00 USD');
    await expectNoA11yViolations();

    // --- 1,000.00 in: 5,000.00 left, 416.67 a month (416.666… rounded up)
    await go(page, 'Transfers');
    await moveIn(page, 'Holiday fund', '1000.00');
    await go(page, 'Goals');
    await expect(row(page, 'Holiday').getByTestId('goal-saved')).toHaveText('1,000.00 USD');
    await expect(row(page, 'Holiday').getByTestId('goal-remaining')).toHaveText('5,000.00 USD');
    await expect(row(page, 'Holiday').getByTestId('goal-percent')).toHaveText('16%');
    await expect(row(page, 'Holiday').getByTestId('goal-monthly')).toHaveText('416.67 USD');
    await expect(row(page, 'Holiday').getByTestId('goal-status')).toHaveText('Active');

    // --- the rest in: achieved
    await go(page, 'Transfers');
    await moveIn(page, 'Holiday fund', '5000.00');
    await go(page, 'Goals');
    await expect(row(page, 'Holiday').getByTestId('goal-status')).toHaveText('Achieved');
    await expect(row(page, 'Holiday').getByTestId('goal-remaining')).toHaveText('0.00 USD');
    await expect(row(page, 'Holiday').getByTestId('goal-percent')).toHaveText('100%');

    // --- a date in the past and not enough saved: overdue, the whole amount left in one month
    await addGoal(page, 'Car', 'Car fund', '2000.00', yesterday);
    await expect(row(page, 'Car').getByTestId('goal-status')).toHaveText('Overdue');
    await expect(row(page, 'Car').getByTestId('goal-monthly')).toHaveText('2,000.00 USD');

    // --- a goal account takes no ordinary transactions (FR-029)
    await go(page, 'Transactions');
    await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Account').selectOption({ label: 'Car fund (USD)' });
    await dialog.getByLabel('Amount (USD)').fill('5.00');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toContainText('goal takes only transfers');
  });
});
