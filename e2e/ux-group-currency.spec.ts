import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go, moreDetails, signUpAndEnter, unlock } from './fixtures/nav.js';
import { choose } from './fixtures/select.js';

// A currency for each account group (spec 021): chosen in the add and rename sheet, kept, and used to show a group's accounts and subtotal in
// that currency with the rates in force; a missing rate is said plainly and never hidden.

const PASSWORD = 'correct horse battery staple';

const section = (page: Page, name: string): Locator => page.getByRole('region', { name, exact: true });

async function addGroup(page: Page, name: string, currency?: string): Promise<void> {
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Group name').fill(name);
  if (currency) await choose(dialog.getByLabel('Currency'), currency);
  await dialog.getByRole('button', { name: 'Add group', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function addAccount(page: Page, name: string, opening: string, currency: string, group: string): Promise<void> {
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await choose(dialog.getByLabel('Currency'), currency);
  await dialog.getByLabel(/^Opening balance/).fill(opening);
  await moreDetails(dialog);
  await choose(dialog.getByLabel('Group', { exact: true }), group);
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

async function setRate(page: Page, currency: string, rate: string): Promise<void> {
  await go(page, 'Advanced');
  await choose(page.getByLabel('Currency', { exact: true }), currency);
  await page.getByLabel(`Rate for ${currency}`).fill(rate);
  await page.getByRole('button', { name: 'Save rate' }).click();
  await expect(page.getByTestId('rate-list')).toContainText(rate);
}

async function changeCurrency(page: Page, group: string, currency: string): Promise<void> {
  await page.getByRole('button', { name: `Edit group: ${group}` }).click();
  const dialog = page.getByRole('dialog');
  await choose(dialog.getByLabel('Currency'), currency);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('@ux group currency', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });
  test.setTimeout(300_000);

  test('a group starts in the Fold currency, and the choice is kept (user story 1)', async ({ page }) => {
    await signUpAndEnter(page);
    await go(page, 'Accounts');
    await page.getByRole('button', { name: 'Add group', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel('Currency')).toContainText('USD');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await addGroup(page, 'Savings');
    await addAccount(page, 'Main', '10.00', 'USD', 'Savings');

    await changeCurrency(page, 'Savings', 'EUR');
    await page.getByRole('button', { name: 'Edit group: Savings' }).click();
    await expect(page.getByRole('dialog').getByLabel('Currency')).toContainText('EUR');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await changeCurrency(page, 'Savings', 'PLN');
    await page.reload();
    await unlock(page, PASSWORD);
    await go(page, 'Accounts');
    await page.getByRole('button', { name: 'Edit group: Savings' }).click();
    await expect(page.getByRole('dialog').getByLabel('Currency')).toContainText('PLN');
  });

  test('shows a mixed-currency group in its own currency, and follows a change of currency (user story 2)', async ({ page, expectNoA11yViolations }) => {
    await signUpAndEnter(page);
    await go(page, 'Accounts');
    await addGroup(page, 'Savings', 'EUR');
    await addAccount(page, 'Euro', '100.00', 'EUR', 'Savings');
    await addAccount(page, 'Dollar', '50.00', 'USD', 'Savings');
    await addAccount(page, 'Zloty', '200.00', 'PLN', 'Savings');
    await setRate(page, 'EUR', '0.9');
    await setRate(page, 'PLN', '4');
    await go(page, 'Accounts');

    // 50.00 USD * 0.9 = 45.00 EUR; 200.00 PLN / 4 * 0.9 = 45.00 EUR; the subtotal is the sum of the figures shown.
    const savings = section(page, 'Savings');
    await expect(savings.getByTestId('group-subtotal')).toContainText('190.00 EUR');
    const row = (name: string) => savings.getByTestId('account-row').filter({ has: page.getByRole('link', { name, exact: true }) });
    await expect(savings.getByTestId('account-converted')).toHaveCount(0); // only the group's sum is converted, never a single account
    await expect(savings.getByTestId('group-subtotal').locator('[title^="Converted at rates from"]')).toHaveCount(1);

    // The group's currency changes how it is shown; the accounts keep their balances.
    await changeCurrency(page, 'Savings', 'PLN');
    await expect(savings.getByTestId('group-subtotal')).toContainText('844.44 PLN');
    await expect(row('Euro').getByTestId('account-balance')).toContainText('100.00 EUR');
    await expectNoA11yViolations();

    // Privacy mode hides the converted subtotal too.
    await page.getByTestId('privacy-switch').click();
    await expect(savings.getByTestId('group-subtotal').locator('[data-privacy-mask]')).toHaveCount(1);
  });

  test('says plainly when a rate is missing, and never shows zero (user story 3)', async ({ page, expectNoA11yViolations }) => {
    await signUpAndEnter(page);
    await go(page, 'Accounts');
    await addGroup(page, 'Travel');
    await addAccount(page, 'Wallet', '20.00', 'EUR', 'Travel');
    const travel = section(page, 'Travel');
    await expect(travel.getByRole('status')).toContainText('Left out: no exchange rate for EUR');
    await expect(travel.getByTestId('group-subtotal')).toContainText('No total yet');
    await expect(travel.getByTestId('group-subtotal')).not.toContainText('0.00');
    await expect(travel.getByTestId('account-row')).toContainText('20.00 EUR');
    await expect(page.getByText('Account saved')).toHaveCount(0, { timeout: 15_000 }); // a toast fading out is not what is being checked
    await expectNoA11yViolations();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectNoA11yViolations();

    await travel.getByRole('link', { name: 'Enter rates' }).click();
    await expect(page).toHaveURL(/\/settings\/advanced\/?#adv-rates/);
    await page.getByLabel('Rate for EUR').fill('0.8');
    await page.getByRole('button', { name: 'Save rate' }).click();
    await expect(page.getByTestId('rate-list')).toContainText('0.8');
    await go(page, 'Accounts');
    await expect(section(page, 'Travel').getByTestId('group-subtotal')).toContainText('25.00 USD');
    await expect(section(page, 'Travel').getByRole('status')).toHaveCount(0);
  });

  test.describe('a Polish session', () => {
    test.use({ locale: 'pl' });

    test('labels the group currency in Polish', async ({ page }) => {
      await signUpAndEnter(page);
      await go(page, 'Accounts');
      await page.getByRole('button', { name: 'Dodaj grupę', exact: true }).click();
      await expect(page.getByRole('dialog').getByLabel('Waluta')).toBeVisible();
    });
  });
});
