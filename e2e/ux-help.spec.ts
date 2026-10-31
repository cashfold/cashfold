import { expect, test } from './fixtures/index.js';
import { createAccount, go, signUpAndEnter } from './fixtures/nav.js';

// Spec 008: Help opens a dialog. In a browser its only keyboard shortcut is the command palette's (spec 015), it offers the getting-started card while steps are left and says so when they
// are done, opens from the sidebar and from the drawer, closes with Escape or Close and gives focus back to Help, and passes the accessibility checks.

test.describe('@ux help', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  test('opens from the sidebar, lists only the palette shortcut in a browser, and closes with Escape or Close, returning focus to Help', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    const help = page.getByRole('button', { name: 'Help', exact: true });
    await help.click();
    const dialog = page.getByRole('dialog', { name: 'Help' });
    await expect(dialog.getByRole('heading', { name: 'Help', level: 2 })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Show the getting-started card' })).toBeVisible();
    await expect(dialog.getByText('Keyboard shortcuts')).toBeVisible();
    await expect(dialog.getByText('Open the command palette')).toBeVisible();
    await expect(dialog.locator('kbd')).toHaveCount(1);
    await expect(dialog.locator('kbd')).toHaveText(/^(⌘K|Ctrl\+K)$/);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(help).toBeFocused();
    await help.click();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(help).toBeFocused();
  });

  test('keeps focus inside the dialog while it is open', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Help' });
    await expect(dialog.getByRole('heading', { name: 'Help', level: 2 })).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  });

  test('offers the card while steps are left, and says it is finished instead once they are all done', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    const help = page.getByRole('button', { name: 'Help', exact: true });
    await help.click();
    await page.getByRole('button', { name: 'Show the getting-started card' }).click();
    await expect(page).toHaveURL(/\/overview\//);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await createAccount(page, 'Everyday', '10.00');
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel(/^Amount/).fill('5.00');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await go(page, 'Overview');
    await help.click();
    const dialog = page.getByRole('dialog', { name: 'Help' });
    await expect(dialog.getByText('You have finished getting started.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Show the getting-started card' })).toHaveCount(0);
  });

  test('opens from the drawer in a narrow window and gives focus back to Help there', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await page.setViewportSize({ width: 390, height: 700 });
    await page.getByRole('button', { name: 'Open menu' }).click();
    const help = page.getByRole('button', { name: 'Help', exact: true });
    await help.click();
    const dialog = page.getByRole('dialog', { name: 'Help' });
    await expect(dialog.getByRole('heading', { name: 'Help', level: 2 })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(help).toBeFocused();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`has no accessibility violations (${scheme} theme)`, async ({ page, expectNoA11yViolations }) => {
      test.setTimeout(240_000);
      await page.emulateMedia({ colorScheme: scheme });
      await signUpAndEnter(page);
      await page.getByRole('button', { name: 'Help', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Help' }).getByRole('heading', { name: 'Help', level: 2 })).toBeVisible();
      await expectNoA11yViolations();
    });
  }
});
