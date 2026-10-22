import { expect, test } from './fixtures/index.js';
import { accountAction, createAccount, go, signUpAndEnter } from './fixtures/nav.js';

// Accounts (FR-028): cards grouped by type, a menu per account, archived accounts behind a remembered toggle, a short form with the rest under
// "More options", and a deletion that states what goes with it.

test.describe('@ux accounts', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  test('creates, archives with a remembered toggle, and deletes with the consequences stated', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await go(page, 'Accounts');
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByLabel('Name', { exact: true })).toBeVisible();
    // The short form shows four fields; the opening date and the rest are under More options.
    await expect(sheet.getByLabel('Opening date')).toHaveCount(0);
    await expectNoA11yViolations();
    await sheet.getByLabel('Name', { exact: true }).fill('Everyday');
    await sheet.getByLabel(/^Opening balance/).fill('50.00');
    await sheet.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('account-row').filter({ hasText: 'Everyday' })).toBeVisible();

    await createAccount(page, 'Rainy day', '10.00');
    await accountAction(page, 'Rainy day', 'Archive');
    await expect(page.getByRole('link', { name: 'Rainy day', exact: true })).toHaveCount(0);
    await page.getByLabel('Show archived accounts').check();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cashfold.ui') ?? '{}').lists.showArchivedAccounts)).toBe(true);
    await expect(page.getByTestId('account-row').filter({ hasText: 'Rainy day' })).toContainText('Archived');

    await accountAction(page, 'Rainy day', 'Delete');
    await expect(page.getByRole('dialog')).toContainText('This also deletes');
  });
});
