import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go, moreDetails } from './fixtures/nav.js';

// User story 6: recurring transactions (FR-062 to FR-066), offline. Dates are relative to the device clock.

const PASSWORD = 'correct horse battery staple';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysFromToday = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const TODAY = daysFromToday(0);
const YESTERDAY = daysFromToday(-1);

test.describe('@us6 schedules', () => {
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

  const balanceOf = (page: Page, account: string) => page.getByTestId('account-row').filter({ hasText: account }).getByTestId('account-balance');
  const projected = (page: Page) => page.getByTestId('projected-row').filter({ hasText: 'Everyday' }).getByTestId('projected-balance');

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

  async function addSchedule(page: Page, s: { name: string; amount: string; first: string; last?: string; confirm?: boolean; unit?: string; every?: string }): Promise<void> {
    await page.getByRole('button', { name: 'Add schedule', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(s.name);
    await dialog.getByLabel('Amount (USD)').fill(s.amount);
    if (s.unit) await dialog.getByLabel('Repeats').selectOption({ label: s.unit });
    if (s.every) await dialog.getByLabel('Every', { exact: true }).fill(s.every);
    await dialog.getByLabel('First on').fill(s.first);
    if (s.last) await dialog.getByLabel('Last on (optional)').fill(s.last);
    if (s.confirm) await dialog.getByLabel('Ask me to confirm each one before it counts').check();
    await dialog.getByRole('button', { name: 'Create schedule' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  test('creates occurrences on their due date, asks for confirmation when told to, projects balances, and edits only the future', async ({ page, context, expectNoA11yViolations }) => {
    await intoApp(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await context.setOffline(true);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();

    await go(page, 'Accounts');
    await addAccount(page, 'Everyday', '1000.00');

    await go(page, 'Schedules');
    await expect(page.getByRole('heading', { level: 1, name: 'Schedules' })).toBeVisible();

    // --- due today and automatic: posted at once
    await addSchedule(page, { name: 'Rent', amount: '400.00', first: TODAY, last: TODAY });
    // --- due yesterday and needing confirmation: waits in the inbox, outside posted balances
    await addSchedule(page, { name: 'Gym', amount: '30.00', first: YESTERDAY, last: YESTERDAY, confirm: true });
    await expect(page.getByTestId('pending-row')).toHaveCount(1);
    await expectNoA11yViolations();
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText('600.00 USD');

    await go(page, 'Schedules');
    await page.getByRole('button', { name: 'Confirm Gym' }).click();
    await expect(page.getByTestId('pending-row')).toHaveCount(0);
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText('570.00 USD');

    // --- a weekly schedule: today's is posted, the next twelve inside the 90-day horizon are only projected
    await go(page, 'Schedules');
    await addSchedule(page, { name: 'Coffee', amount: '10.00', first: TODAY, unit: 'Weeks' });
    await expect(projected(page)).toHaveText('440.00 USD');
    await expect(page.getByTestId('upcoming-row')).toHaveCount(12);
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText('560.00 USD');

    // --- editing changes only what has not been made yet
    await go(page, 'Schedules');
    await page.getByRole('button', { name: 'Edit Coffee' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount (USD)').fill('20.00');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(projected(page)).toHaveText('320.00 USD');
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText('560.00 USD');

    // --- finishing stops further occurrences and keeps the one that was made
    await go(page, 'Schedules');
    await page.getByRole('button', { name: 'Finish Coffee' }).click();
    await expect(projected(page)).toHaveText('560.00 USD');
    await expect(page.getByTestId('upcoming-row')).toHaveCount(0);

    // --- nothing is made twice by reloading
    await page.reload();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await go(page, 'Transactions');
    await expect(page.getByTestId('tx-row')).toHaveCount(3);
  });
});
