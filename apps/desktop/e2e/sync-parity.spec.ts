import { chromium, type Page } from '@playwright/test';
import { createAccount, go } from '../../../e2e/fixtures/nav.js';
import { addExpense, APP_ORIGIN, expect, PASSWORD, test } from './fixtures';

// FR-002, US1 scenario 3: the same account on the web and on the desktop, converging through the relay like any two devices.
// Needs a relay and the web build served; scripts/test-sync-parity.mjs starts both and sets these variables.
const RELAY = process.env['CASHFOLD_E2E_RELAY'];
const WEB = process.env['CASHFOLD_E2E_WEB'];

const syncState = (page: Page) => page.locator('[data-sync-state]');

async function signUpOnWeb(page: Page, email: string, relay: string, web: string): Promise<string> {
  await page.goto(`${web}/sign-up/`);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByLabel('Keep everything on this device for now').uncheck();
  await page.getByLabel('Service address').fill(relay);
  await page.getByRole('button', { name: 'Create account' }).click();
  const secret = page.getByTestId('secret-key');
  await expect(secret).toBeVisible({ timeout: 90_000 });
  const key = ((await secret.textContent()) ?? '').trim();
  await page.getByLabel('I have saved my Secret Key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('current-fold')).toHaveText('Personal');
  return key;
}

test.describe('web and desktop on one account', () => {
  test.skip(RELAY === undefined || WEB === undefined, 'needs a relay and the web build: run `pnpm --filter @cashfold/desktop test:sync`');
  test.setTimeout(300_000);

  test('the desktop signs in to an account made on the web, and changes flow both ways', async ({ session }) => {
    const relay = RELAY!;
    const web = WEB!;
    const email = `alice+${Date.now().toString(36)}@example.com`;
    const browser = await chromium.launch();
    try {
      const webPage = await (await browser.newContext()).newPage();
      const secretKey = await signUpOnWeb(webPage, email, relay, web);
      await createAccount(webPage, 'Everyday', '1,000.00');
      await addExpense(webPage, 'Everyday', '12.50', 'Coffee beans');
      await expect(syncState(webPage)).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });

      // The desktop app joins the account the way a second browser would: from the add-device link, with the password.
      const { page: desktop } = await session.launch();
      const fragment = new URLSearchParams({ email, server: relay, key: secretKey });
      await desktop.goto(`${APP_ORIGIN}/add/#${fragment.toString()}`);
      await expect(desktop.getByRole('heading', { level: 1, name: 'Add this device' })).toBeVisible();
      await desktop.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await desktop.getByRole('button', { name: 'Add this device' }).click();
      // (The address of an app: page is not updated by in-page navigation in the test driver, so wait for the screen itself.)
      await expect(desktop.getByTestId('current-fold')).toHaveText('Personal', { timeout: 90_000 });

      // What the web made is on the desktop, exactly.
      await go(desktop, 'Accounts');
      await expect(desktop.getByRole('link', { name: 'Everyday', exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(desktop.getByTestId('account-row').filter({ hasText: 'Everyday' }).getByTestId('account-balance')).toHaveText('987.50 USD');

      // And the other way round: a change on the desktop reaches the web, and a change on the web reaches the desktop.
      await addExpense(desktop, 'Everyday', '4.00', 'Tea from the desktop');
      await expect(syncState(desktop)).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });
      await go(webPage, 'Transactions');
      await expect(webPage.getByTestId('tx-row').filter({ hasText: 'Tea from the desktop' })).toHaveCount(1, { timeout: 60_000 });

      await addExpense(webPage, 'Everyday', '9.99', 'Lunch from the web');
      await expect(syncState(webPage)).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });
      await go(desktop, 'Transactions');
      await expect(desktop.getByTestId('tx-row').filter({ hasText: 'Lunch from the web' })).toHaveCount(1, { timeout: 60_000 });

      await go(desktop, 'Accounts');
      await expect(desktop.getByTestId('account-row').filter({ hasText: 'Everyday' }).getByTestId('account-balance')).toHaveText('973.51 USD');
    } finally {
      await browser.close();
    }
  });
});
