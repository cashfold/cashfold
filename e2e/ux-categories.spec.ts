import { expect, test } from './fixtures/index.js';
import { createAccount, go, signUpAndEnter } from './fixtures/nav.js';

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

  test('a category is a name and a color: no emoji in the list, no Icon field in the form (spec 019)', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await go(page, 'Categories');
    const pictographic = /\p{Extended_Pictographic}/u;
    const rows = page.getByTestId('category-root');
    await expect(rows.first()).toBeVisible();
    for (const text of await page.getByTestId('category-root').allInnerTexts()) expect(text).not.toMatch(pictographic);
    for (const text of await page.getByTestId('category-child').allInnerTexts()) expect(text).not.toMatch(pictographic);
    await expectNoA11yViolations();

    await page.getByRole('button', { name: 'Add expense category' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Icon', { exact: true })).toHaveCount(0);
    await expect(dialog.locator('#cat-icon')).toHaveCount(0);
    await expect(dialog.getByText('No icon')).toHaveCount(0);
    await expectNoA11yViolations();
    await dialog.getByLabel('Name', { exact: true }).fill('Gadgets');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    const gadgets = page.getByTestId('category-root').filter({ hasText: 'Gadgets' });
    await expect(gadgets).toBeVisible();
    expect(await gadgets.innerText()).not.toMatch(pictographic);

    await gadgets.getByRole('button', { name: 'Actions for Gadgets' }).click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Icon', { exact: true })).toHaveCount(0);
  });

  test('no screen shows an emoji the app drew, while a name typed with one is shown as typed (spec 019)', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await createAccount(page, '💰 Savings', '100.00');
    const pictographic = /\p{Extended_Pictographic}/u;
    for (const screen of ['Overview', 'Accounts', 'Transactions', 'Plan', 'Categories', 'Settings']) {
      await go(page, screen);
      await expect(page.locator('main')).toBeVisible();
      const drawn = await page.evaluate(() => {
        const out: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (parent === null || ['SCRIPT', 'STYLE'].includes(parent.tagName) || (node.textContent ?? '').trim() === '') continue;
          out.push(node.textContent ?? '');
        }
        return out;
      });
      // The only emoji on a screen is the one in the name the person typed.
      expect(drawn.filter((t) => pictographic.test(t) && !t.includes('Savings')), `emoji on ${screen}`).toEqual([]);
    }
    await go(page, 'Accounts');
    await expect(page.getByText('💰 Savings').first()).toBeVisible();
  });
});
