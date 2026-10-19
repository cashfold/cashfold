import type { Browser, BrowserContext, Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures/index.js';

// User story 9: take your data with you, and get back in (FR-008, FR-009, FR-090 to FR-092, FR-101, SC-013, SC-014). Real browsers
// on the real relay built from this checkout: each has its own account, its own encrypted database and its own keys.

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'an entirely different passphrase 42';
const RELAY = `http://localhost:${Number(process.env['E2E_RELAY_PORT'] ?? 3200)}`;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const go = (page: Page, name: string) => page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
const region = (page: Page, name: string) => page.getByRole('region', { name });

async function signUp(page: Page, email: string): Promise<string> {
  await page.goto('/sign-up/');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByLabel('Service address').fill(RELAY);
  await page.getByRole('button', { name: 'Create account' }).click();
  const secret = page.getByTestId('secret-key');
  await expect(secret).toBeVisible({ timeout: 90_000 });
  const key = (await secret.textContent())!.trim();
  await page.getByLabel('I have saved my Secret Key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('fold-name')).toHaveText('Personal');
  return key;
}

async function addAccount(page: Page, name: string, opening: string): Promise<void> {
  await go(page, 'Accounts');
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Opening balance (USD)').fill(opening);
  await dialog.getByLabel('Opening date').fill('2020-01-01');
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

async function addExpense(page: Page, account: string, amount: string, note: string): Promise<void> {
  await go(page, 'Transactions');
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Account').selectOption({ label: `${account} (USD)` });
  await dialog.getByLabel('Amount (USD)').fill(amount);
  await dialog.getByLabel('Note').fill(note);
  await dialog.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** A new browser profile signs in with the Secret Key from the Emergency Kit and the password. */
async function signInNew(browser: Browser, email: string, secretKey: string, password = PASSWORD): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/add/#${new URLSearchParams({ email, server: RELAY, key: secretKey }).toString()}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add this device' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Add this device' }).click();
  await expect(page).toHaveURL(/\/dashboard\/$/, { timeout: 90_000 });
  return { context, page };
}

const balanceOf = (page: Page, account: string) => page.getByTestId('account-row').filter({ hasText: account }).getByTestId('account-balance');
const syncState = (page: Page) => page.locator('[data-sync-state]');

test.describe('@us9 portability and recovery', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });
  test.setTimeout(300_000);

  test('a Recovery Key gets back in with a new password and Secret Key, and the old ones stop working', async ({ page, browser, expectNoA11yViolations }) => {
    const email = `alice+${unique()}@example.com`;
    const secretKey = await signUp(page, email);
    await addAccount(page, 'Everyday', '1,000.00');
    await expect(syncState(page)).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });

    await go(page, 'Settings');
    const section = region(page, 'Recovery Key');
    await section.getByLabel('Current password').fill(PASSWORD);
    await section.getByRole('button', { name: 'Make a Recovery Key' }).click();
    await expect(page.getByTestId('recovery-key')).toBeVisible({ timeout: 60_000 });
    const recoveryKey = (await page.getByTestId('recovery-key').textContent())!.trim();
    expect(recoveryKey).toMatch(/^R1-/);
    await expectNoA11yViolations();
    await section.getByLabel('I have saved it somewhere safe.').check();
    await section.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('recovery-key')).toHaveCount(0);

    // The password and the Secret Key are lost: the Recovery Key and a new password are all there is.
    const lost = await browser.newContext();
    const b = await lost.newPage();
    await b.goto('/recover/');
    await expect(b.getByRole('heading', { level: 1, name: 'Recover your account' })).toBeVisible();
    await expectNoA11yViolationsOn(b);
    await b.getByLabel('Email address', { exact: true }).fill(email);
    await b.getByLabel('Service address').fill(RELAY);
    await b.getByLabel('Recovery Key', { exact: true }).fill(recoveryKey.toLowerCase());
    await b.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await b.getByLabel('New password again').fill(NEW_PASSWORD);
    await b.getByRole('button', { name: 'Recover my account' }).click();
    await expect(b.getByTestId('new-secret-key')).toBeVisible({ timeout: 120_000 });
    const newSecretKey = (await b.getByTestId('new-secret-key').textContent())!.trim();
    expect(newSecretKey).not.toBe(secretKey);
    expect(newSecretKey.slice(0, 9)).toBe(secretKey.slice(0, 9)); // the same account
    await b.getByLabel('I have saved it somewhere safe.').check();
    await b.getByRole('button', { name: 'Done' }).click();
    await expect(b).toHaveURL(/\/dashboard\/$/, { timeout: 30_000 });
    await go(b, 'Accounts');
    await expect(b.getByRole('link', { name: 'Everyday', exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(balanceOf(b, 'Everyday')).toHaveText('1,000.00 USD');

    // The old password with the old Secret Key no longer opens the account; the new details do.
    const old = await browser.newContext();
    const c = await old.newPage();
    await c.goto(`/add/#${new URLSearchParams({ email, server: RELAY, key: secretKey }).toString()}`);
    await c.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await c.getByRole('button', { name: 'Add this device' }).click();
    await expect(c.locator('form [role=alert]')).toContainText('not right', { timeout: 60_000 });
    await old.close();
    const fresh = await signInNew(browser, email, newSecretKey, NEW_PASSWORD);
    await go(fresh.page, 'Accounts');
    await expect(fresh.page.getByRole('link', { name: 'Everyday', exact: true })).toBeVisible({ timeout: 60_000 });
    await fresh.context.close();
    await lost.close();
  });

  async function expectNoA11yViolationsOn(page: Page): Promise<void> {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations).toEqual([]);
  }

  test('changing the password signs the other devices out, keeps the data, and the old password stops working', async ({ page, browser, expectNoA11yViolations }) => {
    const email = `alice+${unique()}@example.com`;
    const secretKey = await signUp(page, email);
    await addAccount(page, 'Everyday', '1,000.00');
    await addExpense(page, 'Everyday', '12.50', 'Coffee beans');
    await expect(syncState(page)).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });
    const other = await signInNew(browser, email, secretKey);

    await go(page, 'Settings');
    const section = region(page, 'Password and Secret Key');
    await section.getByLabel('Current password').fill(PASSWORD);
    await section.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await section.getByLabel('New password again').fill(NEW_PASSWORD);
    await expectNoA11yViolations();
    await section.getByRole('button', { name: 'Change password', exact: true }).last().click();
    await expect(section.getByRole('status')).toContainText('Password changed', { timeout: 90_000 });

    // The other device's saved sign-in no longer works; this one carries on.
    await expect(syncState(other.page)).toHaveAttribute('data-sync-state', 'needs_password', { timeout: 90_000 });
    await expect(syncState(page)).toHaveAttribute('data-sync-state', /synced|syncing/, { timeout: 60_000 });

    // After a reload this device unlocks with the new password only, and its data is still there.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.locator('form [role=alert]')).toContainText('not right');
    await page.getByLabel('Password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await go(page, 'Transactions');
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' })).toHaveCount(1, { timeout: 30_000 });

    // A new device needs the new password.
    const stale = await browser.newContext();
    const c = await stale.newPage();
    await c.goto(`/add/#${new URLSearchParams({ email, server: RELAY, key: secretKey }).toString()}`);
    await c.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await c.getByRole('button', { name: 'Add this device' }).click();
    await expect(c.locator('form [role=alert]')).toContainText('not right', { timeout: 60_000 });
    await stale.close();
    const fresh = await signInNew(browser, email, secretKey, NEW_PASSWORD);
    await go(fresh.page, 'Transactions');
    await expect(fresh.page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' })).toHaveCount(1, { timeout: 60_000 });
    await fresh.context.close();
    await other.context.close();
  });

  test('an encrypted backup restores into a new Fold, and the wrong passphrase gets nothing', async ({ page }) => {
    await signUp(page, `alice+${unique()}@example.com`);
    await addAccount(page, 'Everyday', '1,000.00');
    await addExpense(page, 'Everyday', '12.50', 'Coffee beans');

    await go(page, 'Data');
    const section = region(page, 'Encrypted backup');
    await section.getByLabel('Passphrase', { exact: true }).first().fill('backup passphrase 1');
    await section.getByLabel('Passphrase again').fill('backup passphrase 2');
    await section.getByRole('button', { name: 'Make a backup' }).click();
    await expect(section.getByRole('alert').first()).toContainText('not the same');
    await section.getByLabel('Passphrase again').fill('backup passphrase 1');
    const [download] = await Promise.all([page.waitForEvent('download'), section.getByRole('button', { name: 'Make a backup' }).click()]);
    const file = await download.path();
    expect(download.suggestedFilename()).toMatch(/\.cashfold-backup$/);
    const bytes = readFileSync(file);
    expect(bytes.includes(Buffer.from('Coffee beans'))).toBe(false); // nothing readable in the file
    expect(bytes.includes(Buffer.from('Everyday'))).toBe(false);

    await section.getByLabel('Backup file').setInputFiles(file);
    await section.getByLabel('Passphrase', { exact: true }).last().fill('not the passphrase');
    await section.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(section.getByRole('alert').last()).toContainText('not the passphrase');
    await section.getByLabel('Passphrase', { exact: true }).last().fill('backup passphrase 1');
    await section.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByTestId('restored')).toContainText('Personal (restored)', { timeout: 60_000 });

    await go(page, 'Transactions');
    await page.locator('#ledger-fold').selectOption({ label: 'Personal (restored)' });
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' })).toHaveCount(1, { timeout: 30_000 });
    await go(page, 'Accounts');
    await expect(page.getByRole('link', { name: 'Everyday', exact: true })).toBeVisible();
    await expect(balanceOf(page, 'Everyday')).toHaveText('987.50 USD');
  });

  test('a 5,000-row CSV previews within 5 seconds, imports as one batch and is taken back in one step; export asks for the password', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(480_000);
    await signUp(page, `alice+${unique()}@example.com`);
    await addAccount(page, 'Everyday', '1,000.00');

    const lines = ['date,amount,category,payee,note'];
    for (let i = 0; i < 5_000; i++) lines.push(`2026-03-${String(1 + (i % 28)).padStart(2, '0')},-1.00,,Shop ${i % 40},Row ${i}`);
    const csv = join(tmpdir(), `cashfold-e2e-${unique()}.csv`);
    writeFileSync(csv, lines.join('\r\n'));

    await go(page, 'Data');
    const importing = region(page, 'Import from a CSV file');
    await importing.getByLabel('CSV file').setInputFiles(csv);
    await expect(importing.getByLabel('Date column')).toHaveValue('0');
    await expect(importing.getByLabel('Amount column')).toHaveValue('1');

    const started = Date.now();
    await importing.getByRole('button', { name: 'Show what would be imported' }).click();
    await expect(page.getByTestId('import-preview')).toBeVisible({ timeout: 30_000 });
    const elapsed = Date.now() - started;
    console.log(`preview of 5,000 rows: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(5_000); // SC-014
    await expect(page.getByTestId('import-preview')).toContainText('5,000 rows can be imported');
    await expectNoA11yViolations();

    await importing.getByRole('button', { name: 'Import these rows' }).click();
    await expect(page.getByTestId('import-result')).toContainText('Imported 5,000 rows', { timeout: 240_000 });
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toContainText('4,000.00 USD'); // 1,000.00 less 5,000 × 1.00

    // The same file again: every row now looks like what is already there, so nothing is imported unless asked for.
    await go(page, 'Data');
    await importing.getByLabel('CSV file').setInputFiles(csv);
    await importing.getByRole('button', { name: 'Show what would be imported' }).click();
    await expect(page.getByTestId('import-preview')).toContainText('5,000 look like a duplicate', { timeout: 30_000 });
    await page.getByTestId('import-preview').getByRole('button', { name: 'Cancel' }).click();

    // Export is plain text: it warns, and asks for the password again.
    const exporting = region(page, 'Export to CSV');
    await expect(exporting.getByRole('note')).toContainText('not encrypted');
    await exporting.getByLabel('Current password').fill('not the password');
    await exporting.getByRole('button', { name: 'Export' }).click();
    await expect(exporting.getByRole('alert')).toContainText('not right');
    await exporting.getByLabel('Current password').fill(PASSWORD);
    const [download] = await Promise.all([page.waitForEvent('download'), exporting.getByRole('button', { name: 'Export' }).click()]);
    const text = readFileSync(await download.path(), 'utf8');
    expect(text.split('\n')[0]).toContain('date,account,type,amount,currency');
    expect(text).toContain('Row 4999');

    // One step takes the whole batch back, and nothing else.
    await page.getByRole('button', { name: 'Take this import back' }).first().click();
    await go(page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText('1,000.00 USD', { timeout: 120_000 });
  });

  test('deleting the account erases this device and the service forgets it', async ({ page, browser }) => {
    const email = `alice+${unique()}@example.com`;
    const secretKey = await signUp(page, email);
    await addAccount(page, 'Everyday', '1,000.00');
    await expect(syncState(page)).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });

    await go(page, 'Settings');
    const section = region(page, 'Move or delete your account');
    await section.getByRole('button', { name: 'Delete my account' }).click();
    const submit = section.getByRole('button', { name: 'Delete my account for good' });
    await expect(submit).toBeDisabled(); // the address has to be typed first
    await section.getByLabel(`Type ${email} to confirm`).fill(email);
    await section.getByLabel('Current password').fill('not the password');
    await submit.click();
    await expect(section.getByRole('alert')).toContainText('not right', { timeout: 60_000 });
    await section.getByLabel('Current password').fill(PASSWORD);
    await submit.click();

    // The worker erased this device and locked it; nothing is left to unlock after a reload.
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 120_000 });
    await page.goto('/dashboard/');
    await expect(page.getByRole('link', { name: /Create (an )?account/i })).toBeVisible({ timeout: 60_000 });

    // And the service no longer knows the account: its own credentials open nothing.
    const gone = await browser.newContext();
    const c = await gone.newPage();
    await c.goto(`/add/#${new URLSearchParams({ email, server: RELAY, key: secretKey }).toString()}`);
    await c.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await c.getByRole('button', { name: 'Add this device' }).click();
    await expect(c.locator('form [role=alert]')).toContainText('not right', { timeout: 60_000 });
    await gone.close();
  });
});
