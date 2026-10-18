import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures/index.js';

// User story 1: create a private account and a first Fold, entirely on this device (FR-001 to FR-007, FR-020, FR-022).
// Runs on the production build with the real encrypted database in a real worker.

const PASSWORD = 'correct horse battery staple';
const EMAIL = 'alice@example.com';
const FOLD_NAME = 'Household Budget 2026';

test.describe('@us1 account', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  async function signUp(page: import('@playwright/test').Page, { navigate = true } = {}) {
    if (navigate) await page.goto('/sign-up/');
    await page.getByLabel('Email address', { exact: true }).fill(EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByLabel('Service address').fill('https://relay.example.com');
    await page.getByRole('button', { name: 'Create account' }).click();
    const secret = page.getByTestId('secret-key');
    await expect(secret).toBeVisible({ timeout: 60_000 });
    return (await secret.textContent())!.trim();
  }

  test('signs up offline, shows the Secret Key once, and lands in the first Fold', async ({ page, context, expectNoA11yViolations }) => {
    await page.goto('/sign-up/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoA11yViolations();

    // A returning visitor has the app cached by the service worker. Let it install, then lose the network.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await context.setOffline(true); // sign-up must not need the network
    const secretKey = await signUp(page, { navigate: false });
    expect(secretKey).toMatch(/^C1-[A-HJ-NP-Z2-9]{6}-[A-HJ-NP-Z2-9]{11}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    await expect(page.getByText('could not be reached')).toBeVisible();
    await expectNoA11yViolations();

    const continueButton = page.getByRole('button', { name: 'Continue' });
    await expect(continueButton).toBeDisabled();
    await page.getByLabel('I have saved my Secret Key').check();
    await continueButton.click();

    await expect(page).toHaveURL(/\/folds\/$/);
    await expect(page.getByTestId('fold-name')).toHaveText('Personal');
    await expectNoA11yViolations();
    await expect(page.getByText(secretKey)).toHaveCount(0); // the key is gone from the page
  });

  test('the Emergency Kit download holds the details and is inert', async ({ page }) => {
    const secretKey = await signUp(page);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Emergency Kit' }).click();
    const file = await (await download).path();
    const html = readFileSync(file, 'utf8');
    expect(html).toContain(secretKey);
    expect(html).toContain(EMAIL);
    expect(html).not.toMatch(/<script|<link|<iframe/i);
  });

  test('locks on request, hides everything, and unlocks with the same password (stray spaces ignored)', async ({ page, expectNoA11yViolations }) => {
    await signUp(page);
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('fold-name')).toHaveText('Personal');

    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
    await expect(page.getByText('Personal')).toHaveCount(0);
    await expectNoA11yViolations();

    await page.getByLabel('Password').fill('this is not my password');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.locator('form [role=alert]')).toContainText('not right');

    await page.getByLabel('Password').fill(`  ${PASSWORD}  `);
    await page.getByRole('button', { name: 'Unlock' }).click();
    // In-app navigation keeps the session; a full page load would (correctly) end it.
    await page.getByRole('navigation').getByRole('link', { name: 'Folds' }).click();
    await expect(page.getByTestId('fold-name')).toHaveText('Personal');
  });

  test('stays locked after a reload and needs the password again', async ({ page }) => {
    await signUp(page);
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('fold-name')).toHaveText('Personal');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Personal')).toHaveCount(0);
  });

  test('hides content as soon as the window loses focus (FR-007)', async ({ page }) => {
    await signUp(page);
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('fold-name')).toHaveText('Personal');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.getByTestId('privacy-cover')).toBeVisible();
    await expect(page.locator('main[inert], div[inert]').first()).toBeAttached();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('privacy-cover')).toHaveCount(0);
  });

  test('creates, renames and deletes Folds, with an explicit confirmation to delete (FR-020, FR-022)', async ({ page, expectNoA11yViolations }) => {
    await signUp(page);
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByLabel('Fold name').fill(FOLD_NAME);
    await page.getByLabel('Base currency').selectOption('EUR');
    await page.getByRole('button', { name: 'Create Fold' }).click();
    await expect(page.getByTestId('fold-name')).toHaveText(['Personal', FOLD_NAME]);

    await page.getByRole('button', { name: `Rename ${FOLD_NAME}` }).click();
    await page.getByLabel('Fold name').first().fill('Household');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByTestId('fold-name')).toHaveText(['Personal', 'Household']);

    await page.getByRole('button', { name: 'Delete Household' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('permanently removes Household');
    await expectNoA11yViolations();
    await dialog.getByLabel('Type the Fold name to confirm').fill('household');
    await dialog.getByRole('button', { name: 'Delete Fold' }).click();
    await expect(dialog).toContainText('does not match');
    await dialog.getByLabel('Type the Fold name to confirm').fill('Household');
    await dialog.getByRole('button', { name: 'Delete Fold' }).click();
    await expect(page.getByTestId('fold-name')).toHaveText(['Personal']);

    // the last Fold cannot be deleted
    await page.getByRole('button', { name: 'Delete Personal' }).click();
    await expect(page.getByRole('dialog')).toContainText('at least one Fold');
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Delete Fold' })).toHaveCount(0);
  });

  test('a second tab shares the unlocked session, and locking in one tab locks both', async ({ page, context }) => {
    await signUp(page);
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('fold-name')).toHaveText('Personal');

    const second = await context.newPage();
    await second.goto('/folds/');
    await expect(second.getByTestId('fold-name')).toHaveText('Personal', { timeout: 30_000 });

    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(second.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 15_000 });
  });

  test('leaves no key, password or Fold name in readable form in any browser storage, console or network traffic', async ({ page, leakScan }) => {
    const capture = leakScan.begin();
    const secretKey = await signUp(page);
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Fold name').fill(FOLD_NAME);
    await page.getByRole('button', { name: 'Create Fold' }).click();
    await expect(page.getByTestId('fold-name')).toHaveText(['Personal', FOLD_NAME]);

    const secretChars = secretKey.slice(10).replaceAll('-', '');
    await leakScan.expectNoLeaks({ strings: [PASSWORD, FOLD_NAME, secretChars, secretKey], amounts: [] }, capture);
  });
});
