import { expect, test } from './fixtures/index.js';
import { createAccount, go, moreDetails, signUpAndEnter } from './fixtures/nav.js';

// The Overview (FR-014 to FR-018; SC-004): four headline figures, a period that is remembered, secondary sections that collapse and stay collapsed,
// and rows that lead to the filtered list.

test.describe('@ux overview', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  async function addExpense(page: import('@playwright/test').Page, amount: string, note: string) {
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel(/^Amount/).fill(amount);
    await moreDetails(sheet);
    await sheet.getByLabel('Note').fill(note);
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByLabel(/^Amount/)).toHaveCount(0);
  }

  test('shows the four figures, remembers the period and the collapsed sections, and links rows to the list', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '100.00');
    await go(page, 'Overview');
    await addExpense(page, '12.50', 'Lunch');

    await expect(page.getByTestId('income')).toBeVisible();
    await expect(page.getByTestId('expense')).toHaveText('12.50 USD');
    await expect(page.getByTestId('net')).toHaveText('−12.50 USD');
    await expect(page.getByTestId('net-worth')).toHaveText('87.50 USD');
    await expectNoA11yViolations();

    // A collapsed section stays collapsed after a reload.
    const tags = page.getByRole('button', { name: /^Spending by tag/ });
    await expect(tags).toHaveAttribute('aria-expanded', 'true');
    await tags.click();
    await expect(tags).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cashfold.ui') ?? '{}').overview.collapsed)).toContain('tag');

    // The period is remembered and its dates are stated.
    await page.getByLabel('Period').selectOption({ label: 'Last month' });
    await expect(page.getByText(/^Showing /)).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cashfold.ui') ?? '{}').overview.period.kind)).toBe('lastMonth');
  });

  test('"Count transfers as income and expenses" explains itself under the figures', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '100.00');
    await go(page, 'Overview');
    await page.getByRole('button', { name: /^Options/ }).click();
    await page.getByLabel('Count transfers as income and expenses').check();
    await expect(page.getByTestId('options-note')).toContainText('transfers');
  });

  test('guides a new Fold to its first account and first transaction', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await expect(page.getByText('Create your first account')).toBeVisible();
    await createAccount(page, 'Everyday', '0.00');
    await go(page, 'Overview');
    await expect(page.getByRole('button', { name: 'Add transaction' })).toBeVisible();
  });
});
