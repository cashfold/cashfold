import { expect, test } from './fixtures/index.js';
import { go, signUpAndEnter } from './fixtures/nav.js';

// The Categories page: a row shows its category and ONE actions button, instead of seven buttons a row. Every action is in that button's menu.

test.describe('@ux categories', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  test('each row has one button, and the menu has every action', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await go(page, 'Categories');
    const root = page.getByTestId('category-root').first();
    const header = root.locator('> div').first();
    await expect(header.getByRole('button')).toHaveCount(1);
    await expect(page.getByTestId('category-child').first().getByRole('button')).toHaveCount(1);
    const name = (await header.locator('strong').innerText()).trim();

    await header.getByRole('button', { name: `Actions for ${name}` }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Edit', `Add subcategory to ${name}`, `Move ${name} up`, `Move ${name} down`, 'Merge', 'Archive', 'Delete']);
    await expect(page.getByRole('menuitem', { name: `Move ${name} up` })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expectNoA11yViolations();
  });

  test('a menu action works: archive and restore a category', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await go(page, 'Categories');
    const row = page.getByTestId('category-root').first();
    const header = row.locator('> div').first();
    const name = (await header.locator('strong').innerText()).trim();
    await header.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
    await expect(header).toContainText('Archived');
    await header.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Restore', exact: true }).click();
    await expect(header).not.toContainText('Archived');
  });
});
