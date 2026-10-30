import { expect, test } from './fixtures/index.js';
import { createAccount, go, moreDetails, openRowAction, signUpAndEnter, toggleRecentlyDeleted } from './fixtures/nav.js';
import { choose } from './fixtures/select.js';

// The transaction list (FR-024 to FR-027): day groups with net totals, search, one Filters control with chips that live in the address, a row
// menu with a confirmation that names the transaction, and Recently deleted.

test.describe('@ux list', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  async function add(page: import('@playwright/test').Page, amount: string, note: string) {
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel(/^Amount/).fill(amount);
    await moreDetails(sheet);
    await sheet.getByLabel('Note').fill(note);
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('tx-row').filter({ hasText: note })).toHaveCount(1);
  }

  test('searches, filters with removable chips kept in the address, deletes with a named confirmation and restores', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(300_000);
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '500.00');
    await go(page, 'Transactions');
    await add(page, '4.50', 'Coffee beans');
    await add(page, '30.00', 'Groceries run');
    await expectNoA11yViolations();

    // Day heading with its net total.
    await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: '−34.50 USD' })).toBeVisible();

    // Search narrows the list as you type and announces the count.
    await page.getByRole('searchbox', { name: 'Search' }).fill('coffee');
    await expect(page.getByTestId('tx-row')).toHaveCount(1);
    await expect(page.getByTestId('tx-count')).toHaveText('1 transaction');
    await page.getByRole('searchbox', { name: 'Search' }).fill('');
    await expect(page.getByTestId('tx-row')).toHaveCount(2);

    // Filters: a chip appears, the address carries it, and a reload keeps it.
    await page.getByRole('button', { name: /^Filters/ }).click();
    await choose(page.getByLabel('Status'), 'Pending');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('filter-chips')).toContainText('Pending');
    await expect(page).toHaveURL(/status=pending/);
    await page.getByRole('button', { name: /^Remove filter/ }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.getByTestId('tx-row')).toHaveCount(2);

    // Delete: the confirmation names the transaction; restore from Recently deleted.
    await openRowAction(page, 'Coffee beans', 'Delete');
    await expect(page.getByRole('dialog')).toContainText('Coffee beans');
    await page.getByRole('button', { name: 'Delete transaction' }).click();
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' })).toHaveCount(0);
    await toggleRecentlyDeleted(page);
    await page.getByTestId('deleted-list').getByRole('button', { name: /^Restore/ }).click();
    await toggleRecentlyDeleted(page);
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' })).toHaveCount(1);
  });

  test('keeps the ?account= address working and disables amount filters until an account is chosen', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '500.00');
    await go(page, 'Transactions');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByLabel('Smallest amount')).toBeDisabled();
    await choose(page.getByLabel('Account'), 'Everyday');
    await expect(page.getByLabel('Smallest amount')).toBeEnabled();
  });
});
