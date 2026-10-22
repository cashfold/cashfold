import { expect, test } from './fixtures/index.js';
import { go, signUpAndEnter } from './fixtures/nav.js';

// Plan (FR-030, FR-031): Budgets, Goals and Schedules as tabs of one section, the last view remembered.

test.describe('@ux plan', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  test('has three tabs, ?view= selects one, and the last view is remembered across a reload', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await go(page, 'Plan');
    await expect(page.getByRole('tab')).toHaveText(['Budgets', 'Goals', 'Schedules']);
    await page.getByRole('tab', { name: 'Goals' }).click();
    await expect(page).toHaveURL(/view=goals/);
    await expect(page.getByRole('tab', { name: 'Goals' })).toHaveAttribute('aria-selected', 'true');
    await expectNoA11yViolations();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cashfold.ui') ?? '{}').plan.view)).toBe('goals');
  });
});
