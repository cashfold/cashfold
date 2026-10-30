import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { createAccount, go, lock, openAddTransaction, unlock } from './fixtures/nav.js';
import { choose, chooseLanguage } from './fixtures/select.js';

// Spec 010: an account that never talks to a relay. Production build, real encrypted database in a real worker.
// The build under test has no default relay, so sign-up offers to keep everything on this device.

const PASSWORD = 'correct horse battery staple';
const EMAIL = 'alice@example.com';
const LOCAL = 'Keep everything on this device for now';
const RELAY = `http://localhost:${Number(process.env['E2E_RELAY_PORT'] ?? 3200)}`;

/** Every request that leaves the app's own origin (the relay, a font, a rate source, anything). */
function watchOutsideRequests(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/^(data|blob|about|chrome-extension):/.test(url)) return;
    if (new URL(url).origin !== new URL(page.url() === 'about:blank' ? url : page.url()).origin) outside.push(url);
  });
  return outside;
}

async function fillSignUp(page: Page, { navigate = true } = {}): Promise<void> {
  if (navigate) await page.goto('/sign-up/');
  await page.getByLabel('Email address', { exact: true }).fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
}

async function signUpLocal(page: Page): Promise<string> {
  await fillSignUp(page);
  await page.getByLabel(LOCAL).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  const secret = page.getByTestId('secret-key');
  await expect(secret).toBeVisible({ timeout: 60_000 });
  return (await secret.textContent())!.trim();
}

async function enterApp(page: Page): Promise<void> {
  await page.getByLabel('I have saved my Secret Key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/overview\/$/);
  await expect(page.getByTestId('current-fold')).toHaveText('Personal');
}

async function makeBackup(page: Page): Promise<void> {
  await go(page, 'Data');
  const backup = page.getByRole('region', { name: 'Encrypted backup' });
  await backup.getByLabel('Passphrase', { exact: true }).first().fill('backup passphrase 1');
  await backup.getByLabel('Passphrase again').fill('backup passphrase 1');
  await Promise.all([page.waitForEvent('download'), backup.getByRole('button', { name: 'Make a backup' }).click()]);
  await go(page, 'Data');
  await expect(page.getByRole('region', { name: 'Storage' })).toContainText('Last backup');
}

test.describe('@us10 local-only sign-up', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  // ---- User story 1: create an account without a relay ----

  test('offers to keep everything on this device, with no address and no "find me by email", and gets you to the first Fold', async ({ page, expectNoA11yViolations }) => {
    await page.goto('/sign-up/');
    const box = page.getByLabel(LOCAL);
    await expect(box).toBeChecked(); // FR-013: the build has no default relay
    await expect(page.getByLabel('Service address')).toHaveCount(0);
    await expect(page.getByLabel(/find me by my email/)).toHaveCount(0);
    await expect(page.getByText('Stays on this device unless you connect a service later.')).toBeVisible();
    await expectNoA11yViolations();

    const secretKey = await signUpLocal(page);
    expect(secretKey).toMatch(/^C1-[A-HJ-NP-Z2-9]{6}-[A-HJ-NP-Z2-9]{11}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    await expect(page.getByTestId('local-backup-tip')).toContainText('Make an encrypted backup'); // FR-007a
    await expect(page.getByText('could not be reached')).toHaveCount(0);
    await expectNoA11yViolations();

    await enterApp(page);
    await expect(page.getByText(secretKey)).toHaveCount(0); // the key is gone from the page
  });

  test('the Emergency Kit has no service address and no add-device link', async ({ page }) => {
    const secretKey = await signUpLocal(page);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Emergency Kit' }).click();
    const html = readFileSync((await (await download).path())!, 'utf8');
    expect(html).toContain(secretKey);
    expect(html).toContain(EMAIL);
    expect(html).toContain('Stored only on this device');
    expect(html).not.toMatch(/https?:\/\/|#email=|server=|<svg/);
  });

  test('sends nothing to any service, through sign-up, a session, lock, unlock and a reload (FR-004, FR-011, SC-002)', async ({ page }) => {
    const outside = watchOutsideRequests(page);
    await signUpLocal(page);
    await enterApp(page);
    await createAccount(page, 'Everyday', '100.00');
    await lock(page);
    await unlock(page, PASSWORD);
    await go(page, 'Accounts');
    await page.reload();
    await unlock(page, PASSWORD);
    await expect(page.getByRole('link', { name: 'Everyday', exact: true })).toBeVisible();
    expect(outside, 'requests that left the app').toEqual([]);
  });

  test('an address typed before choosing to keep everything on this device is not used', async ({ page }) => {
    let relayHits = 0;
    await page.route('https://relay.example.com/**', (route) => {
      relayHits++;
      return route.abort();
    });
    await fillSignUp(page);
    await page.getByLabel(LOCAL).uncheck();
    await page.getByLabel('Service address').fill('https://relay.example.com');
    await page.getByLabel(LOCAL).check();
    await expect(page.getByLabel('Service address')).toHaveCount(0);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 60_000 });
    await enterApp(page);
    expect(relayHits).toBe(0);
  });

  test('unticking it brings back the address, which is then required', async ({ page }) => {
    await fillSignUp(page);
    await page.getByLabel(LOCAL).uncheck();
    await expect(page.getByLabel('Service address')).toBeVisible();
    await expect(page.getByLabel(/find me by my email/)).toBeVisible();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('form [role=alert], [aria-invalid=true]').first()).toBeVisible(); // not a quiet local-only account
    await expect(page.getByTestId('secret-key')).toHaveCount(0);
  });

  // ---- User story 2: know that this device is on its own ----

  test('says "Local only" everywhere that matters, and never mistakes it for a fault', async ({ page, context, expectNoA11yViolations }) => {
    await signUpLocal(page);
    await enterApp(page);
    const indicator = page.locator('[data-sync-state]').first();
    await expect(indicator).toHaveText('Local only');
    await expect(indicator).toHaveAttribute('data-sync-state', 'local');
    await context.setOffline(true);
    await page.waitForTimeout(500);
    await expect(indicator).toHaveText('Local only');
    await context.setOffline(false);
    await expect(indicator).toHaveText('Local only');

    // Settings → Profile: no empty address, no "Pending" (FR-006a)
    await go(page, 'Profile');
    const account = page.getByRole('region', { name: 'Account on this device' });
    await expect(account).toContainText('Local only');
    await expect(account).not.toContainText('Pending');
    await expect(account).not.toContainText('Service address');

    // Settings → Sync: explained, with the way to connect (FR-007)
    await go(page, 'Devices');
    await expect(page.getByRole('heading', { name: 'Stored on this device only' })).toBeVisible();
    await expect(page.getByTestId('local-backup-note')).toContainText('A forgotten password cannot be recovered');
    await expect(page.getByLabel('Service address')).toBeVisible();
    await expect(page.getByLabel(/find me by my email/)).not.toBeChecked();
    // nothing on this page reads as a fault: no offline alert, no empty device list (FR-006)
    await expect(page.locator('main [role=alert]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Devices on this account' })).toHaveCount(0);
    await expectNoA11yViolations();
  });

  test('shows sharing disabled, with the reason and the way out (FR-007b)', async ({ page, expectNoA11yViolations }) => {
    await signUpLocal(page);
    await enterApp(page);
    await go(page, 'Folds');
    const notice = page.getByTestId('relay-needed');
    await expect(notice).toContainText('Sharing needs a service.');
    await expect(notice.getByRole('link', { name: 'Connect to a service' })).toHaveAttribute('href', /\/settings\/sync\/?$/);
    const share = page.getByRole('button', { name: /^Sharing/ }).first();
    await expect(share).toBeDisabled();
    await expect(share).toHaveAccessibleDescription(/Sharing needs a service/);
    await expectNoA11yViolations();
  });

  test('asks for a backup on the Getting started card, and ticks it once one is made (FR-007a)', async ({ page }) => {
    await signUpLocal(page);
    await enterApp(page);
    await createAccount(page, 'Everyday', '100.00');
    await go(page, 'Overview');
    await go(page, 'Transactions');
    await openAddTransaction(page);
    const sheet = page.getByRole('dialog');
    await choose(sheet.getByLabel('Account'), 'Everyday (USD)');
    await sheet.getByLabel('Amount (USD)').fill('4.50');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await go(page, 'Overview');
    const card = page.getByTestId('first-run');
    await expect(card).toContainText('Make a backup');
    await makeBackup(page);
    await go(page, 'Overview');
    await expect(page.getByTestId('first-run')).toHaveCount(0); // every step is done, so the card is gone
  });

  // ---- User story 3: connect to a relay later ----

  test('connects later: a wrong address changes nothing, the right one keeps every record and syncs to a second device', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const email = `local-${randomBytes(4).toString('hex')}@example.com`;
    await page.goto('/sign-up/');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByLabel(LOCAL).check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 60_000 });
    const secretKey = (await page.getByTestId('secret-key').textContent())!.trim();
    await enterApp(page);
    await createAccount(page, 'Everyday', '100.00');

    await go(page, 'Devices');
    // an address nothing listens on: a specific message, still local, data intact (FR-010)
    await page.getByLabel('Service address').fill('http://localhost:9');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Turn on sync' }).click();
    await expect(page.locator('form [role=alert]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-sync-state]').first()).toHaveText('Local only');

    // the real relay; "find me by email" stays off unless ticked
    await page.getByLabel('Service address').fill(RELAY);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await expect(page.getByLabel(/find me by my email/)).not.toBeChecked();
    await page.getByRole('button', { name: 'Turn on sync' }).click();
    await expect(page.getByText('Sync is on.')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-sync-state]').first()).not.toHaveText('Local only');
    await go(page, 'Accounts');
    await expect(page.getByRole('link', { name: 'Everyday', exact: true })).toHaveCount(1); // present, and not duplicated

    // a second device is added with the Emergency Kit details and sees the same account
    const other = await browser.newContext();
    const second = await other.newPage();
    await second.goto(`/add/#${new URLSearchParams({ email, server: RELAY, key: secretKey }).toString()}`);
    await expect(second.getByRole('heading', { level: 1, name: 'Add this device' })).toBeVisible();
    await second.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await second.getByRole('button', { name: 'Add this device' }).click();
    await expect(second).toHaveURL(/\/overview\/$/, { timeout: 90_000 });
    await go(second, 'Accounts');
    await expect(second.getByRole('link', { name: 'Everyday', exact: true })).toHaveCount(1, { timeout: 60_000 });
    await other.close();
  });

  // ---- Every new string, in every language (FR-014, SC-005) ----

  const WORDS = {
    uk: { local: 'Поки що зберігати все лише на цьому пристрої', indicator: 'Лише на цьому пристрої', sync: 'Зберігається лише на цьому пристрої', sharing: 'Для спільного доступу потрібен сервіс.' },
    pl: { local: 'Na razie zachowaj wszystko na tym urządzeniu', indicator: 'Tylko na tym urządzeniu', sync: 'Przechowywane tylko na tym urządzeniu', sharing: 'Udostępnianie wymaga usługi.' },
  } as const;
  const RAW_KEY = /\b(signup|synclocal|sharing|secretkey|kit|sync|firstrun|settings)\.[a-zA-Z_]+(\.[a-zA-Z_]+)*\b/;

  for (const code of ['uk', 'pl'] as const) {
    test(`reads in ${code}: the choice, the indicator, the Sync page and the sharing notice, with no raw message key`, async ({ page, expectNoA11yViolations }) => {
      test.setTimeout(120_000);
      const words = WORDS[code];
      await page.goto('/sign-up/');
      await chooseLanguage(page.getByLabel('Language'), code);
      await expect(page.getByLabel(words.local)).toBeChecked();
      expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);
      await expectNoA11yViolations();
      await page.locator('input[type=email]').fill(EMAIL);
      const passwords = page.locator('input[type=password]');
      await passwords.nth(0).fill(PASSWORD);
      await passwords.nth(1).fill(PASSWORD);
      await page.locator('form button[type=submit]').click();
      await page.getByTestId('secret-key').waitFor({ timeout: 60_000 });
      expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);
      await page.locator('[role=checkbox]').first().check();
      await page.locator('main button:not([disabled])').last().click();
      await expect(page.getByTestId('current-fold').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-sync-state="local"]')).toHaveText(words.indicator);
      await go(page, 'Devices');
      await expect(page.getByRole('heading', { name: words.sync })).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);
      await expectNoA11yViolations();
      await go(page, 'Folds');
      await expect(page.getByTestId('relay-needed')).toContainText(words.sharing);
      expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);
    });
  }
});

