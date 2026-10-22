import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go } from './fixtures/nav.js';

// Durability and several tabs (ARCHITECTURE 8.1a, FR-072): the app asks the browser to keep its data and says so when it will not, reminds
// people whose data is only on their device to make a backup, and keeps one writer however many tabs are open.

const PASSWORD = 'correct horse battery staple';
const RELAY = `http://localhost:${Number(process.env['E2E_RELAY_PORT'] ?? 3200)}`;
const NOWHERE = 'http://localhost:9'; // nothing listens here: the account is made on this device and registered later
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function signUp(page: Page, server = RELAY): Promise<void> {
  await page.goto('/sign-up/');
  await page.getByLabel('Email address', { exact: true }).fill(`tab+${unique()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByLabel('Service address').fill(server);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 90_000 });
  await page.getByLabel('I have saved my Secret Key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('current-fold')).toHaveText('Personal');
}

async function addAccount(page: Page, name: string): Promise<void> {
  await go(page, 'Accounts');
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Opening balance (USD)').fill('100.00');
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Makes the browser answer the storage questions as told, and counts how often it was asked to keep the data. */
async function browserWillKeep(page: Page, answer: boolean): Promise<void> {
  await page.addInitScript((keep) => {
    let kept = false;
    const w = window as unknown as { __persistCalls: number };
    w.__persistCalls = 0;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persisted: async () => kept,
        persist: async () => {
          w.__persistCalls++;
          kept = keep;
          return keep;
        },
        estimate: async () => ({ usage: 12_345_678, quota: 5_000_000_000 }),
        getDirectory: () => (Object.getPrototypeOf(navigator) as { storage?: StorageManager }).storage?.getDirectory?.() ?? Promise.reject(new Error('no OPFS')),
      },
    });
  }, answer);
}

test.describe('@durability storage and tabs', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });
  test.setTimeout(240_000);

  test('asks the browser to keep the data, once, and is quiet when it agrees', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the storage manager is replaced for the page only in Chromium');
    await browserWillKeep(page, true);
    await signUp(page);
    await addAccount(page, 'Everyday');
    await go(page, 'Data');
    await expect(page.getByTestId('storage-state')).toContainText('has agreed to keep');
    await expect(page.getByTestId('storage-warning')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __persistCalls: number }).__persistCalls)).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole('region', { name: 'Storage' })).toContainText('in use');
  });

  test('says so when the browser will not keep it, and lets the person ask again', async ({ page, browserName, expectNoA11yViolations }) => {
    test.skip(browserName !== 'chromium', 'the storage manager is replaced for the page only in Chromium');
    await browserWillKeep(page, false);
    await signUp(page);
    await expect(page.getByTestId('storage-warning')).toHaveCount(0); // nothing worth losing yet
    await addAccount(page, 'Everyday');
    await go(page, 'Transactions');
    await expect(page.getByTestId('storage-warning')).toContainText('Your data is also on the service', { timeout: 30_000 });
    await expectNoA11yViolations();
    await go(page, 'Data');
    await expect(page.getByTestId('storage-state')).toContainText('has not agreed');
    await page.getByRole('button', { name: 'Ask the browser to keep my data' }).click();
    await expect(page.getByRole('region', { name: 'Storage' }).getByRole('status')).toContainText('asked again');
  });

  test('reminds someone whose data is only on this device to make a backup, until they do', async ({ page, expectNoA11yViolations }) => {
    await signUp(page, NOWHERE);
    await expect(page.getByTestId('backup-nag')).toHaveCount(0); // nothing worth losing yet
    await addAccount(page, 'Everyday');
    await go(page, 'Transactions');
    const nag = page.getByTestId('backup-nag');
    await expect(nag).toContainText('only on this device', { timeout: 30_000 });
    await expect(page.getByTestId('storage-notice')).toHaveAttribute('data-level', 'strong');
    await expectNoA11yViolations();

    // Putting it off hides it for now.
    await page.getByRole('button', { name: 'Remind me in a week' }).click();
    await expect(nag).toHaveCount(0);

    // A backup settles it, and the reminder stays away after a reload and an unlock.
    await go(page, 'Data');
    const backup = page.getByRole('region', { name: 'Encrypted backup' });
    await backup.getByLabel('Passphrase', { exact: true }).first().fill('backup passphrase 1');
    await backup.getByLabel('Passphrase again').fill('backup passphrase 1');
    const [download] = await Promise.all([page.waitForEvent('download'), backup.getByRole('button', { name: 'Make a backup' }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.cashfold-backup$/);
    await go(page, 'Data');
    await expect(page.getByRole('region', { name: 'Storage' })).toContainText('Last backup');
  });

  test('keeps one writer however many tabs are open: changes in either tab show in both', async ({ page, context }) => {
    await signUp(page);
    await addAccount(page, 'First tab');

    const second = await context.newPage();
    await second.goto('/accounts/');
    await expect(second.getByRole('link', { name: 'First tab', exact: true })).toBeVisible({ timeout: 30_000 });

    // A change made in the second tab is saved through the same worker and appears in the first without a reload.
    await addAccount(second, 'Second tab');
    await go(page, 'Transactions');
    await go(page, 'Accounts');
    await expect(page.getByRole('link', { name: 'Second tab', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('account-row')).toHaveCount(2);
    await expect(second.getByTestId('account-row')).toHaveCount(2);

    // Both tabs agree on the balances, and neither sees a duplicate.
    await expect(page.getByTestId('account-row').filter({ hasText: 'First tab' }).getByTestId('account-balance')).toHaveText('100.00 USD');
    await expect(second.getByTestId('account-row').filter({ hasText: 'Second tab' }).getByTestId('account-balance')).toHaveText('100.00 USD');
  });

  test('closing the tab that holds the unlocked session leaves the other tab locked, and the data is still there after unlocking', async ({ page, context }) => {
    await signUp(page);
    await addAccount(page, 'Before');
    const second = await context.newPage();
    await second.goto('/accounts/');
    await expect(second.getByRole('link', { name: 'Before', exact: true })).toBeVisible({ timeout: 30_000 });

    // The keys live only in the first tab's worker. When it goes, nothing keeps them: the second tab asks for the password again.
    await page.close();
    await expect(second.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 90_000 });
    await expect(second.getByText('Before')).toHaveCount(0);
    await second.getByLabel('Password').fill(PASSWORD);
    await second.getByRole('button', { name: 'Unlock' }).click();
    await go(second, 'Accounts');
    await expect(second.getByRole('link', { name: 'Before', exact: true })).toBeVisible({ timeout: 60_000 });
    await addAccount(second, 'After');
    await expect(second.getByTestId('account-row')).toHaveCount(2);
  });
});
