import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go } from './fixtures/nav.js';
import { choose, chooseAccount } from './fixtures/select.js';

// Every account dropdown shows each account's balance next to its name, the same figure the Accounts page shows (spec 013: FR-001, FR-003,
// FR-007, FR-009; SC-002).

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
  if (currency) await choose(dialog.getByLabel('Currency'), currency);
  await dialog.getByLabel(/Opening balance/).fill(opening);
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

const balanceOnPage = async (page: Page, name: string): Promise<string> => {
  await go(page, 'Accounts');
  return (await page.getByTestId('account-row').filter({ hasText: name }).getByTestId('account-balance').innerText()).trim();
};

test.describe('@ux account balances in dropdowns', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  test('the add and transfer dropdowns show the balance the Accounts page shows', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(300_000);
    await intoApp(page);
    await addAccount(page, 'Everyday', '100.00');
    await addAccount(page, 'Euro wallet', '40.00', 'EUR');
    const everyday = await balanceOnPage(page, 'Everyday');
    const euro = await balanceOnPage(page, 'Euro wallet');

    // The add sheet: each option reads as name then balance, and the closed control keeps showing it.
    await go(page, 'Transactions');
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Account').click();
    await expect(page.getByRole('option', { name: 'Everyday' })).toContainText(everyday);
    await expect(page.getByRole('option', { name: 'Euro wallet' })).toContainText(euro);
    await expectNoA11yViolations();
    await page.keyboard.press('Escape');

    // A new expense changes the balance the next time the list is opened.
    await chooseAccount(sheet.getByLabel('Account'), 'Everyday');
    await sheet.getByLabel(/^Amount/).fill('10.00');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('tx-row')).toHaveCount(1);
    const after = await balanceOnPage(page, 'Everyday');
    expect(after).not.toBe(everyday);
    await go(page, 'Transactions');
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByRole('dialog').getByLabel('Account').click();
    await expect(page.getByRole('option', { name: 'Everyday' })).toContainText(after);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // The transfer tab: both lists.
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Transfer' }).click();
    const dialog = page.getByRole('dialog');
    for (const label of ['From account', 'To account']) {
      await dialog.getByLabel(label).click();
      await expect(page.getByRole('option', { name: /^Euro wallet/ })).toContainText(euro);
      await expect(page.getByRole('option', { name: /^Everyday/ })).toContainText(after);
      await page.keyboard.press('Escape');
    }
  });
});
