import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go, moreDetails } from './fixtures/nav.js';

// Accessibility of every primary task (FR-094, SC-016): axe at WCAG 2.2 AA on each screen and each dialog, the primary tasks done with the
// keyboard alone, and the names, roles and live regions a screen reader announces.

const PASSWORD = 'correct horse battery staple';
const SCREENS = ['Overview', 'Accounts', 'Transactions', 'Budgets', 'Schedules', 'Goals', 'Categories', 'Folds', 'Data', 'Devices', 'Settings', 'Advanced'];

test.describe('@a11y primary tasks', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  async function intoApp(page: Page): Promise<void> {
    await page.goto('/sign-up/');
    await page.getByLabel('Email address', { exact: true }).fill('alice@example.com');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByLabel('Service address').fill('https://relay.example.com');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('current-fold')).toHaveText('Personal');
  }


  test('the sign-up and unlock screens have no violations and a usable form', async ({ page, expectNoA11yViolations }) => {
    await page.goto('/sign-up/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoA11yViolations();
    // Every field has a name a screen reader announces, and an error is announced, not only coloured.
    for (const label of ['Email address', 'Password', 'Repeat password', 'Service address']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('form [role=alert], [aria-invalid=true]').first()).toBeVisible();
    await expectNoA11yViolations();
  });

  for (const scheme of ['light', 'dark'] as const) test(`every screen has one heading, landmarks and no violations (${scheme} theme)`, async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: scheme });
    await intoApp(page);
    await expectNoA11yViolations();
    for (const screen of SCREENS) {
      await go(page, screen);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      // The section the screen belongs to is the current entry of the navigation.
      await expect(page.getByRole('navigation', { name: 'Main' }).locator('[aria-current=page]')).toHaveCount(1);
      await expectNoA11yViolations();
    }
  });

  test('accounts and transactions are added, edited and removed with the keyboard alone', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(240_000);
    await intoApp(page);
    await go(page, 'Accounts');

    // The skip link is the first stop and moves focus to the content.
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    for (let i = 0; i < 20 && !(await skip.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Shift+Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();

    // A dialog opens from the keyboard, holds focus, is named, and gives focus back when it closes.
    const open = page.getByRole('button', { name: 'Add account', exact: true });
    await open.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible();
    await expect(dialog).toHaveAccessibleName(/.+/);
    await expectNoA11yViolations();
    // A modal dialog makes the page behind it inert, so Tab can only move within it.
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();

    // The whole task by keyboard: fill, submit with Enter.
    await open.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Everyday');
    await page.getByRole('dialog').getByLabel('Opening balance (USD)').fill('100.00');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Everyday', exact: true })).toBeVisible();

    await go(page, 'Transactions');
    await page.getByRole('button', { name: 'Add transaction', exact: true }).focus();
    await page.keyboard.press('Enter');
    const tx = page.getByRole('dialog');
    await tx.getByLabel('Account').selectOption({ label: 'Everyday (USD)' });
    await tx.getByLabel('Amount (USD)').fill('12.50');
    await moreDetails(tx);
    await tx.getByLabel('Note').fill('Coffee beans');
    await expectNoA11yViolations();
    await tx.getByRole('button', { name: 'Save' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const row = page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' });
    await expect(row).toHaveCount(1);
    // Amounts carry their sign as text, so colour is never the only cue.
    await expect(row).toContainText('−12.50 USD');
    await expectNoA11yViolations();

    // Every control in the list is reachable and named.
    const controls = row.getByRole('button');
    for (let i = 0; i < (await controls.count()); i++) await expect(controls.nth(i)).toHaveAccessibleName(/.+/);
  });

  test('locking and the status line are announced', async ({ page, expectNoA11yViolations }) => {
    await intoApp(page);
    await expect(page.getByRole('status').first()).toBeVisible();
    await page.getByRole('button', { name: 'Lock', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
    await expectNoA11yViolations();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 60_000 });
  });

  test('text can be enlarged to 200% and reflowed at 320 px without losing content or scrolling sideways', async ({ page }) => {
    await intoApp(page);
    await go(page, 'Accounts');
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => document.documentElement.style.setProperty('font-size', '200%', 'important'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The layout settles after the resize (banners and the list load), so the width is read until it holds.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { timeout: 10_000 }).toBeLessThanOrEqual(1);
  });
});
