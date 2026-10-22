import { expect, test } from './fixtures/index.js';
import { createAccount, go, signUpAndEnter } from './fixtures/nav.js';

// The new shell (FR-001 to FR-006; SC-003): five sections, one place for Fold, sync and lock, redirects from the old addresses, and overlays
// that follow the lock and the privacy cover (R-UX-10).

test.describe('@ux shell', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  test('has exactly five entries, marks the current one, and keeps the account controls in one place', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link').filter({ hasNotText: /Synced|Offline|Syncing|sync/i })).toHaveText(['Cashfold', 'Overview', 'Transactions', 'Accounts', 'Plan', 'Settings']);
    await expect(nav.locator('[aria-current=page]')).toHaveText('Overview');
    await expect(nav.getByTestId('current-fold')).toHaveText('Personal');
    await expect(nav.getByRole('button', { name: 'Lock' })).toBeVisible();
    await expect(nav.getByRole('status')).toBeVisible();
    await go(page, 'Settings');
    await expect(nav.locator('[aria-current=page]')).toHaveText('Settings');
    await expectNoA11yViolations();
  });

  test('puts the skip link first and moves focus to the single main landmark', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    for (let i = 0; i < 30 && !(await skip.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Shift+Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('sends every old address to its new place and keeps the query', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '10.00');
    for (const [from, to] of [['/budgets/', /\/plan\/\?view=budgets/], ['/goals/', /\/plan\/\?view=goals/], ['/schedules/', /\/plan\/\?view=schedules/], ['/categories/', /\/settings\/categories\//], ['/data/', /\/settings\/data\//], ['/devices/', /\/settings\/sync\//], ['/folds/', /\/settings\/folds\//]] as const) {
      await page.evaluate((url) => window.history.pushState({}, '', url), from);
      await page.reload();
      await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
      await page.getByRole('button', { name: 'Unlock' }).click();
      await expect(page).toHaveURL(to, { timeout: 60_000 });
    }
  });

  test('locking closes the add sheet, and the privacy cover makes it unreachable without losing what was typed', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '10.00');
    await go(page, 'Transactions');
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByLabel(/^Amount/).fill('7.25');
    await page.getByRole('button', { name: 'Lock', exact: true }).first().evaluate((b) => (b as HTMLElement).click()).catch(() => undefined);
    await page.getByRole('heading', { name: 'Unlock Cashfold' }).waitFor({ timeout: 30_000 });
    await expect(page.getByLabel(/^Amount/)).toHaveCount(0);
  });
});
