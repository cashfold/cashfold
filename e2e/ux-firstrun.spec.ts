import { expect, test } from './fixtures/index.js';
import { createAccount, go, signUpAndEnter } from './fixtures/nav.js';

// First run (FR-036 to FR-038; SC-009): a skippable checklist that stays dismissed, reopenable from Help; empty states; one-time hints.

test.describe('@ux first run', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  test('shows the checklist, derives its steps from the data, and stays dismissed until Help offers it back', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    const card = page.getByTestId('first-run');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Create your Fold');
    await createAccount(page, 'Everyday', '0.00');
    await go(page, 'Overview');
    await expect(card.locator('li').nth(1)).toContainText('done');
    await card.getByRole('button', { name: 'Dismiss' }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('current-fold')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('first-run')).toHaveCount(0);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('button', { name: 'Show the getting-started card' }).click();
    await expect(page.getByTestId('first-run')).toBeVisible();
  });

  test('a one-time hint appears once and does not come back', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await go(page, 'Folds');
    const hint = page.getByTestId('hint-folds-sharing');
    await expect(hint).toBeVisible();
    await hint.getByRole('button', { name: 'Got it' }).click();
    await expect(hint).toHaveCount(0);
    await go(page, 'Overview');
    await go(page, 'Folds');
    await expect(page.getByTestId('hint-folds-sharing')).toHaveCount(0);
  });
});
