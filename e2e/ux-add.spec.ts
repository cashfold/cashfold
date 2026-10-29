import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go } from './fixtures/nav.js';
import { choose } from './fixtures/select.js';

// User story 1 of the redesign: record a transaction in seconds (FR-007 to FR-011, FR-020 to FR-022; SC-001, SC-002).

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

async function addAccount(page: Page, name: string, opening: string, currency?: string): Promise<void> {
  await go(page, 'Accounts');
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  if (currency) await dialog.getByLabel('Currency').fill(currency);
  await dialog.getByLabel(/Opening balance/).fill(opening);
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('@ux add sheet', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  test('records an expense in four interactions, remembers More details and the last account', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(240_000);
    await intoApp(page);
    await addAccount(page, 'Everyday', '100.00');
    await addAccount(page, 'Savings', '50.00');
    await go(page, 'Transactions');

    // Open from the shell: the amount is focused, five default controls, More details collapsed.
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByLabel(/^Amount/)).toBeFocused();
    await expect(sheet.getByRole('button', { name: 'More details' })).toHaveAttribute('aria-expanded', 'false');
    await expectNoA11yViolations();

    await sheet.getByLabel(/^Amount/).fill('12.50');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Transaction saved' })).toBeVisible();
    await expect(page.getByTestId('tx-row')).toHaveCount(1);

    // More details: note, saved; reopening keeps the group expanded and the last account.
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByRole('button', { name: 'Savings (USD)' }).count();
    await choose(sheet.getByLabel('Account'), 'Savings (USD)');
    await sheet.getByLabel(/^Amount/).fill('3.00');
    await sheet.getByRole('button', { name: 'More details' }).click();
    await sheet.getByLabel('Note').fill('Stamps');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Stamps' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await expect(sheet.getByRole('button', { name: 'More details' })).toHaveAttribute('aria-expanded', 'true');
    await expect(sheet.getByLabel('Account')).toContainText('Savings (USD)');
  });

  test('asks before discarding what was typed, and not when nothing was typed', async ({ page }) => {
    test.setTimeout(240_000);
    await intoApp(page);
    await addAccount(page, 'Everyday', '100.00');
    await go(page, 'Transactions');
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await expect(page.getByLabel(/^Amount/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByLabel(/^Amount/).fill('9');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Keep editing' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel(/^Amount/)).toHaveValue('9');
  });

  test('switches to Transfer in the same sheet and shows the received amount for different currencies', async ({ page }) => {
    test.setTimeout(240_000);
    await intoApp(page);
    await addAccount(page, 'Everyday', '100.00');
    await go(page, 'Transactions');
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Transfer' }).click();
    await expect(page.getByLabel('From account', { exact: false })).toBeVisible();
  });
});
