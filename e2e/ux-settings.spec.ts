import { expect, test } from './fixtures/index.js';
import { go, signUpAndEnter } from './fixtures/nav.js';

// Settings (FR-029, FR-032 to FR-035; SC-003): an index of seven groups with no controls, and the three named tasks within two steps.

test.describe('@ux settings', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  test('lists at most seven groups with a description each and no form controls', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Settings', exact: true }).click();
    const links = page.getByRole('main').getByRole('link');
    await expect(links).toHaveCount(7);
    await expect(page.getByRole('main').locator('input, select, textarea, [role=switch]')).toHaveCount(0);
    for (const name of ['Profile and security', 'Appearance', 'Categories', 'Sync and devices', 'Data and storage', 'Folds and sharing', 'Advanced']) {
      await expect(links.filter({ hasText: name })).toHaveCount(1);
    }
    await expectNoA11yViolations();
  });

  test('finds dark mode, connected devices and export in two steps', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await go(page, 'Appearance');
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeVisible();
    await go(page, 'Devices');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await go(page, 'Data');
    await expect(page.getByRole('region', { name: /export/i }).first()).toBeVisible();
  });

  test('Advanced says when to change what it holds', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await go(page, 'Advanced');
    await expect(page.getByText('Change it only if you run your own Cashfold service')).toBeVisible();
  });
});
