import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { chooseFold, go, moreDetails, openAddTransaction } from './fixtures/nav.js';
import { choose } from './fixtures/select.js';

// A device whose storage misbehaves (FR-072, FR-016, edge cases): the browser is shut down the moment a change was confirmed; a page of the
// encrypted database is overwritten while the app is locked. Confirmed changes are never lost without a word, a damaged file is kept, what can
// be read is saved, and a signed-in person gets the rest back from the service.

const PASSWORD = 'correct horse battery staple';
const RELAY = `http://localhost:${Number(process.env['E2E_RELAY_PORT'] ?? 3200)}`;
const NOWHERE = 'http://localhost:9';
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function signUp(page: Page, server: string): Promise<string> {
  await page.goto('/sign-up/');
  const email = `rec+${unique()}@example.com`;
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByLabel('Keep everything on this device for now').uncheck();
  await page.getByLabel('Service address').fill(server);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 90_000 });
  await page.getByLabel('I have saved my Secret Key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('current-fold')).toHaveText('Personal');
  return email;
}

async function addAccount(page: Page, name: string): Promise<void> {
  await go(page, 'Accounts');
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Opening balance (USD)').fill('100.00');
  await moreDetails(dialog);
  await dialog.getByLabel('Opening date').fill('2020-01-01');
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function addExpense(page: Page, account: string, amount: string, note: string): Promise<void> {
  await go(page, 'Transactions');
  await openAddTransaction(page);
  const dialog = page.getByRole('dialog');
  await choose(dialog.getByLabel('Account'), `${account} (USD)`);
  await dialog.getByLabel('Amount (USD)').fill(amount);
  await moreDetails(dialog);
  await dialog.getByLabel('Note').fill(note);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function unlock(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

/** Overwrites 512 bytes in the middle of the encrypted database file, as a failing disk might. The app must be locked: no worker holds the file. */
async function damageDatabase(page: Page): Promise<void> {
  await expect(async () => {
    const damaged = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await (await root.getDirectoryHandle('cashfold')).getDirectoryHandle('.opaque');
      let done = false;
      for await (const [, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemFileHandle]> }).entries()) {
        const file = await handle.getFile();
        const path = new TextDecoder().decode(new Uint8Array(await file.slice(0, 512).arrayBuffer())).split('\0')[0];
        if (path !== '/cashfold.db') continue;
        const middle = 4096 + 4096 * Math.floor((file.size - 4096) / 4096 / 2);
        const writable = await (handle as unknown as { createWritable(o: { keepExistingData: boolean }): Promise<FileSystemWritableFileStream> }).createWritable({ keepExistingData: true });
        await writable.seek(middle);
        await writable.write(crypto.getRandomValues(new Uint8Array(512)));
        await writable.close();
        done = true;
      }
      return done;
    });
    expect(damaged).toBe(true);
  }).toPass({ timeout: 20_000 });
}

test.describe('@storage a device whose storage misbehaves', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'writes into the origin private file system from the page, and restarts the browser profile (Chromium)');
  });
  test.setTimeout(300_000);

  test('a change that was confirmed is there after the browser is shut down at once', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    const profile = mkdtempSync(join(tmpdir(), 'cashfold-profile-'));
    const open = async (): Promise<{ context: BrowserContext; page: Page }> => {
      const context = await chromium.launchPersistentContext(profile, { baseURL });
      return { context, page: context.pages()[0] ?? (await context.newPage()) };
    };
    const first = await open();
    await signUp(first.page, NOWHERE);
    await addAccount(first.page, 'Everyday');
    await addExpense(first.page, 'Everyday', '12.50', 'Coffee beans'); // confirmed: the dialog closed
    await first.context.close(); // and the browser goes away at once

    const second = await open();
    await second.page.goto('/transactions/');
    await unlock(second.page);
    await go(second.page, 'Transactions');
    await expect(second.page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' })).toHaveCount(1, { timeout: 60_000 });
    await go(second.page, 'Accounts');
    await expect(second.page.getByTestId('account-row').filter({ hasText: 'Everyday' }).getByTestId('account-balance')).toHaveText('87.50 USD');
    await expect(second.page.getByTestId('recovery-notice')).toHaveCount(0); // nothing was damaged
    await second.context.close();
  });

  test('a damaged database is kept, what can be read is saved, and a signed-in person gets the rest back from the service', async ({ page, expectNoA11yViolations }) => {
    await signUp(page, RELAY);
    await addAccount(page, 'Everyday');
    await addExpense(page, 'Everyday', '12.50', 'Coffee beans');
    // The indicator still says "synced" for a moment after a change, before the push starts: let it start, then wait for it to end.
    await page.waitForTimeout(3_000);
    await expect(page.locator('[data-sync-state]')).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });
    await page.waitForTimeout(1_500);
    await expect(page.locator('[data-sync-state]')).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });

    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
    await page.waitForTimeout(1_500); // the worker lets go of the file
    await damageDatabase(page);

    await unlock(page);
    const notice = page.getByTestId('recovery-notice');
    await expect(notice).toBeVisible({ timeout: 60_000 });
    await expect(notice).toContainText('could not be read');
    await expect(notice).toContainText('fetched again');
    await expectNoA11yViolations();
    await notice.getByRole('button', { name: 'I have read this' }).click();

    // The service has everything: it comes back, and the balance is right.
    await go(page, 'Accounts');
    await expect(page.getByTestId('account-row').filter({ hasText: 'Everyday' }).getByTestId('account-balance')).toHaveText('87.50 USD', { timeout: 90_000 });
    await go(page, 'Transactions');
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' })).toHaveCount(1, { timeout: 60_000 });

    // The app carries on as before: a new change is saved and survives another lock and unlock.
    await addExpense(page, 'Everyday', '1.00', 'After recovery');
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await unlock(page);
    await go(page, 'Transactions');
    await expect(page.getByTestId('tx-row').filter({ hasText: 'After recovery' })).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByTestId('recovery-notice')).toHaveCount(0);
  });

  test('without a service, the person is told, and a backup puts the data back', async ({ page }) => {
    await signUp(page, NOWHERE);
    await addAccount(page, 'Everyday');
    await addExpense(page, 'Everyday', '12.50', 'Coffee beans');

    await go(page, 'Data');
    const backup = page.getByRole('region', { name: 'Encrypted backup' });
    await backup.getByLabel('Passphrase', { exact: true }).first().fill('backup passphrase 1');
    await backup.getByLabel('Passphrase again').fill('backup passphrase 1');
    const [download] = await Promise.all([page.waitForEvent('download'), backup.getByRole('button', { name: 'Make a backup' }).click()]);
    const file = await download.path();

    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
    await page.waitForTimeout(1_500);
    await damageDatabase(page);

    await unlock(page);
    const notice = page.getByTestId('recovery-notice');
    await expect(notice).toBeVisible({ timeout: 60_000 });
    await expect(notice).toContainText('only on this device may be missing');
    await notice.getByRole('link', { name: 'If you have a backup, restore it here.' }).click();

    const restore = page.getByRole('region', { name: 'Encrypted backup' });
    await restore.getByLabel('Backup file').setInputFiles(file);
    await restore.getByLabel('Passphrase', { exact: true }).last().fill('backup passphrase 1');
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByTestId('restored')).toContainText('(restored)', { timeout: 60_000 });
    await go(page, 'Transactions');
    // The switcher appears when the damaged Fold was kept beside the restored one; otherwise the restored Fold is the only one.
    if (await page.getByRole('button', { name: /^Switch Fold/ }).count()) await chooseFold(page, 'Personal (restored)', 'Transactions');
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' })).toHaveCount(1, { timeout: 30_000 });
  });
});
