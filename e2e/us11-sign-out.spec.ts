import { randomBytes } from 'node:crypto';
import net from 'node:net';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { createAccount, go, lock, moreDetails, openAddTransaction } from './fixtures/nav.js';
import { expectNoResidue } from './fixtures/residue.js';
import { choose, chooseLanguage } from './fixtures/select.js';

// Spec 011: leaving the account on this device so another can be used. Production build, real encrypted database in a real worker, and the real relay
// built from this checkout for the accounts that are on a service. Chromium and Firefox, as the other specs that need OPFS in workers.

const PASSWORD = 'correct horse battery staple';
const RELAY_PORT = Number(process.env['E2E_RELAY_PORT'] ?? 3200);
const RELAY = `http://localhost:${RELAY_PORT}`;
const LOCAL = 'Keep everything on this device for now';
const unique = () => `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const email = (who: string) => `${who}-${unique()}@example.com`;

/** A TCP hop between one browser and the relay that can be cut and restored (HTTP and WebSocket alike), as in the sync spec. */
async function relayLink(): Promise<{ url: string; setUp(up: boolean): void; close(): Promise<void> }> {
  let up = true;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    if (!up) return void client.destroy();
    const upstream = net.connect(RELAY_PORT, '127.0.0.1');
    for (const s of [client, upstream]) sockets.add(s);
    const done = () => {
      for (const s of [client, upstream]) {
        s.destroy();
        sockets.delete(s);
      }
    };
    client.pipe(upstream);
    upstream.pipe(client);
    for (const s of [client, upstream]) s.on('error', done).on('close', done);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `http://localhost:${port}`,
    setUp(next) {
      up = next;
      if (!next) for (const s of sockets) s.destroy();
    },
    close: () => new Promise<void>((resolve) => (server.close(() => resolve()), sockets.forEach((s) => s.destroy()))),
  };
}

/** A scan of the page's storage that cannot hang the test: it either answers or fails with a clear message. */
async function withTimeout<T>(work: Promise<T>, what: string, ms = 60_000): Promise<T> {
  return Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms))]);
}

async function fill(page: Page, address: string): Promise<void> {
  await page.goto('/sign-up/');
  await page.getByLabel('Email address', { exact: true }).fill(address);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
}

async function finishSignUp(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Create account' }).click();
  const secret = page.getByTestId('secret-key');
  await expect(secret).toBeVisible({ timeout: 90_000 });
  const key = (await secret.textContent())!.trim();
  await page.getByLabel('I have saved my Secret Key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('current-fold')).toHaveText('Personal');
  return key;
}

/** Signs up with an account that is on a service. Returns its Secret Key. */
async function signUpOnService(page: Page, address: string, server = RELAY): Promise<string> {
  await fill(page, address);
  await page.getByLabel(LOCAL).uncheck();
  await page.getByLabel('Service address').fill(server);
  return finishSignUp(page);
}

/** Signs up with an account kept only on this device. */
async function signUpLocal(page: Page, address: string): Promise<string> {
  await fill(page, address);
  await page.getByLabel(LOCAL).check();
  return finishSignUp(page);
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

async function openSignOut(page: Page) {
  await go(page, 'Profile');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Sign out of this device?' })).toBeVisible();
  return dialog;
}

const confirmButton = (dialog: ReturnType<Page['getByRole']>) => dialog.getByRole('button', { name: /^Sign out and erase/ });

async function expectSignedOutScreen(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'You are signed out' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in on this device' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Recover an account' })).toBeVisible();
}

async function enrol(browser: Browser, address: string, secretKey: string, server = RELAY): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/add/#${new URLSearchParams({ email: address, server, key: secretKey }).toString()}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add this device' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Add this device' }).click();
  await expect(page).toHaveURL(/\/overview\/$/, { timeout: 90_000 });
  return { context, page };
}

test.describe('@us11 sign out and switch account', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });
  test.setTimeout(240_000);

  // ---- User story 1: sign out of an account that is also on a service ----

  test('has its own section, distinct from Lock and Delete, and a confirmation that says what happens and starts on Cancel', async ({ page, expectNoA11yViolations }) => {
    await signUpOnService(page, email('alice'));
    await go(page, 'Profile');
    const section = page.getByRole('region', { name: 'Sign out of this device' });
    await expect(section).toContainText('It is not Lock');
    await expect(section).toContainText('not Delete');
    await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible(); // still its own thing

    const dialog = await openSignOut(page);
    await expect(dialog).toContainText("This device's copy of the account will be erased.");
    await expect(dialog).toContainText('your other devices are not affected');
    await expect(dialog).toContainText('add this device with your Secret Key and password');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog.getByLabel(/^Type /)).toHaveCount(0); // nothing to type for an account that lives elsewhere too
    await expectNoA11yViolations();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('current-fold')).toBeVisible(); // nothing happened
  });

  test('signs out completely, leaves the account intact elsewhere, and says nothing about the device being removed', async ({ page, browser, leakScan }) => {
    const address = email('alice');
    const secretKey = await signUpOnService(page, address);
    await createAccount(page, 'Everyday', '100.00');
    await addExpense(page, 'Everyday', '12.50', 'flat white');

    // No waiting for the header to say "synced": with the service reachable, signing out sends what has not reached it before it erases (FR-006)
    const dialog = await openSignOut(page);
    await confirmButton(dialog).click();
    await expectSignedOutScreen(page);
    await expect(page.getByText('This device was removed from the account')).toHaveCount(0);
    await expect(page.getByText(address)).toHaveCount(0); // FR-011: nothing that names the account
    await expectNoResidue(page);
    await page.waitForTimeout(500); // the old worker ends just after the reply
    await withTimeout(leakScan.expectNoLeaks({ strings: [address, 'Everyday', 'flat white'], amounts: ['12.50'] }), 'leak scan');

    // the account is intact on another device, which sees this one as removed
    const second = await enrol(browser, address, secretKey);
    await go(second.page, 'Accounts');
    await expect(second.page.getByRole('link', { name: 'Everyday', exact: true })).toBeVisible({ timeout: 60_000 });
    await go(second.page, 'Transactions');
    await expect(second.page.getByTestId('tx-row').filter({ hasText: 'flat white' })).toHaveCount(1, { timeout: 30_000 }); // the last change made before signing out arrived
    await go(second.page, 'Devices');
    await expect(second.page.getByText('(removed)')).toBeVisible({ timeout: 30_000 });
    await second.context.close();
  });

  test('says how many changes have not reached the service, and lets them be synced first', async ({ page }) => {
    const link = await relayLink();
    try {
      await signUpOnService(page, email('alice'), link.url);
      await createAccount(page, 'Everyday', '100.00');
      await expect(page.locator('[data-sync-state]').first()).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });
      link.setUp(false);
      await addExpense(page, 'Everyday', '4.00', 'unsent coffee');

      const dialog = await openSignOut(page);
      const pending = dialog.getByTestId('signout-pending');
      await expect(pending).toContainText(/\d+ changes? ha(s|ve) not reached the service yet/, { timeout: 30_000 });
      await expect(pending).toContainText('The service cannot be reached');
      await expect(confirmButton(dialog)).toBeDisabled(); // an extra tick is needed to lose them
      await dialog.getByLabel('Sign out anyway and lose those changes').check();
      await expect(confirmButton(dialog)).toBeEnabled();
      await dialog.getByLabel('Sign out anyway and lose those changes').uncheck();

      link.setUp(true);
      // Pressing it is what reaches the service again; if the connection is still coming up, a person presses it again.
      await expect(async () => {
        const sync = dialog.getByRole('button', { name: 'Sync now' });
        if (await sync.count()) await sync.click({ timeout: 5_000 });
        await expect(dialog.getByTestId('signout-pending')).toHaveCount(0, { timeout: 15_000 });
      }).toPass({ timeout: 120_000 });
      await expect(confirmButton(dialog)).toBeEnabled();
    } finally {
      await link.close();
    }
  });

  test('works with the service out of reach, and tells the person the device may stay listed', async ({ page }) => {
    const link = await relayLink();
    try {
      await signUpOnService(page, email('alice'), link.url);
      await expect(page.locator('[data-sync-state]').first()).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });
      link.setUp(false);
      const dialog = await openSignOut(page);
      await confirmButton(dialog).click();
      await expectSignedOutScreen(page);
      await expect(page.getByTestId('signout-listed')).toContainText('may still be listed under your account');
      await expectNoResidue(page);
    } finally {
      await link.close();
    }
  });

  test('moves every open tab to the signed-out screen, and no tab says the device was removed (FR-012)', async ({ page, context }) => {
    await signUpOnService(page, email('alice'));
    const other = await context.newPage();
    await other.goto('/accounts/');
    await expect(other.getByRole('heading', { level: 1 })).toBeVisible();
    const dialog = await openSignOut(page);
    await confirmButton(dialog).click();
    await expectSignedOutScreen(page);
    await expectSignedOutScreen(other);
    await expect(other.getByText('This device was removed from the account')).toHaveCount(0);
  });

  // ---- User story 2: sign out of an account that exists only on this device ----

  test('warns that it is the only copy, offers a backup, and needs the typed email, then leaves nothing and the backup brings the data back', async ({ page, leakScan, expectNoA11yViolations }) => {
    const address = email('local');
    await signUpLocal(page, address);
    await createAccount(page, 'Everyday', '100.00');
    await addExpense(page, 'Everyday', '12.50', 'flat white');

    let dialog = await openSignOut(page);
    await expect(dialog.getByTestId('signout-only-copy')).toContainText('only copy of this account');
    await expect(dialog.getByTestId('signout-only-copy')).toBeVisible();
    await expect(dialog.getByTestId('signout-backup')).toContainText('You have not made a backup.');
    await expect(confirmButton(dialog)).toBeDisabled();
    await dialog.getByLabel(/^Type /).fill('someone@else.com');
    await expect(confirmButton(dialog)).toBeDisabled();
    await expectNoA11yViolations();

    // a backup first, and the way back to this confirmation
    await dialog.getByRole('link', { name: 'Make a backup first' }).click();
    await expect(page).toHaveURL(/settings\/data\/\?then=sign-out/);
    const backup = page.getByRole('region', { name: 'Encrypted backup' });
    await backup.getByLabel('Passphrase', { exact: true }).first().fill('backup passphrase 1');
    await backup.getByLabel('Passphrase again').fill('backup passphrase 1');
    const [download] = await Promise.all([page.waitForEvent('download'), backup.getByRole('button', { name: 'Make a backup' }).click()]);
    const file = await download.path();
    await page.getByRole('link', { name: 'Back to sign out' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Sign out of this device?' })).toBeVisible();
    await expect(dialog.getByTestId('signout-backup')).toContainText('Last backup:');
    await expect(confirmButton(dialog)).toBeDisabled(); // the email is still required after a backup

    await dialog.getByLabel(/^Type /).fill(`  ${address.toUpperCase()} `);
    await expect(confirmButton(dialog)).toBeEnabled();
    await confirmButton(dialog).click();
    await expectSignedOutScreen(page);
    await expectNoResidue(page);
    await page.waitForTimeout(500);
    await withTimeout(leakScan.expectNoLeaks({ strings: [address, 'Everyday', 'flat white'], amounts: ['12.50'] }), 'leak scan');

    // the backup is the way back: a new account restores it
    await page.getByRole('link', { name: 'Create an account' }).click();
    await fill(page, email('next'));
    await page.getByLabel(LOCAL).check();
    await finishSignUp(page);
    await go(page, 'Data');
    const restore = page.getByRole('region', { name: 'Encrypted backup' });
    await restore.getByLabel('Backup file').setInputFiles(file);
    await restore.getByLabel('Passphrase', { exact: true }).last().fill('backup passphrase 1');
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByTestId('restored')).toBeVisible({ timeout: 60_000 });
    await go(page, 'Accounts');
    // Restoring makes a new Fold beside the empty one, with the name the backup had, so the Folds are told apart by what is in them.
    const everyday = page.getByRole('link', { name: 'Everyday', exact: true });
    if ((await everyday.count()) === 0) {
      await page.getByRole('button', { name: /^Switch Fold/ }).first().click();
      await page.getByRole('menuitem').last().click();
    }
    await expect(everyday).toBeVisible({ timeout: 30_000 });
  });

  // ---- User story 3: switch to another account ----

  test('switches account: a new one starts empty and fresh, language and theme are kept, and the old one signs back in', async ({ page, browser }) => {
    const first = email('first');
    const secondAddress = email('second');
    const key = await signUpOnService(page, first);
    await createAccount(page, 'Everyday', '100.00');
    await expect(page.locator('[data-sync-state]').first()).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });
    await go(page, 'Appearance');
    await chooseLanguage(page.getByLabel('Language'), 'uk'); // a device preference, which must survive
    await expect(page.locator('h1').first()).toHaveText('Вигляд');

    await go(page, 'Profile');
    await page.getByRole('button', { name: 'Вийти', exact: true }).click();
    await page.getByRole('button', { name: /^Вийти й стерти/ }).click();
    await expect(page.getByRole('link', { name: 'Створити обліковий запис' })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk');

    // a new account: empty, with its own Getting started card, and nothing of the first
    await page.getByRole('link', { name: 'Створити обліковий запис' }).click();
    await page.locator('input[type=email]').fill(secondAddress);
    const passwords = page.locator('input[type=password]');
    await passwords.nth(0).fill(PASSWORD);
    await passwords.nth(1).fill(PASSWORD);
    await page.getByLabel('Поки що зберігати все лише на цьому пристрої').check();
    await page.locator('form button[type=submit]').click();
    await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 90_000 });
    await page.getByRole('checkbox').first().check();
    await page.locator('main button:not([disabled])').last().click();
    await expect(page.getByTestId('first-run')).toBeVisible({ timeout: 30_000 });
    await go(page, 'Accounts');
    await expect(page.getByRole('link', { name: 'Everyday', exact: true })).toHaveCount(0);
    await expect(page.getByText(first)).toHaveCount(0);

    // and the first account signs back in here, as a new device, with its data
    await go(page, 'Profile');
    await page.getByRole('button', { name: 'Вийти', exact: true }).click();
    await page.getByLabel(/^Введіть /).fill(secondAddress);
    await page.getByRole('button', { name: /^Вийти й стерти/ }).click();
    await expect(page.getByRole('link', { name: 'Увійти на цьому пристрої' })).toBeVisible({ timeout: 30_000 });
    await page.goto(`/add/#${new URLSearchParams({ email: first, server: RELAY, key }).toString()}`);
    await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
    await page.locator('main button[type=submit], main form button').last().click();
    await expect(page).toHaveURL(/\/overview\/$/, { timeout: 90_000 });
    await go(page, 'Accounts');
    await expect(page.getByRole('link', { name: 'Everyday', exact: true })).toBeVisible({ timeout: 60_000 });
    void browser;
  });

  // ---- User story 4: use a different account from the lock screen ----

  test('lets the lock screen erase with the typed email and no password, and a wrong one erases nothing', async ({ page }) => {
    const address = email('locked');
    await signUpOnService(page, address);
    await lock(page);
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
    await page.getByRole('button', { name: 'Use a different account' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(address);
    await expect(dialog.getByLabel('Password')).toHaveCount(0);
    await expect(confirmButton(dialog)).toBeDisabled();

    await dialog.getByLabel(/^Type /).fill('someone@else.com');
    await expect(confirmButton(dialog)).toBeDisabled();
    await dialog.getByLabel(/^Type /).fill(address);
    await expect(confirmButton(dialog)).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    // nothing was erased: the password still opens it
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('current-fold').first()).toBeVisible({ timeout: 60_000 });
    await lock(page);

    await page.getByRole('button', { name: 'Use a different account' }).click();
    await page.getByRole('dialog').getByLabel(/^Type /).fill(address);
    await confirmButton(page.getByRole('dialog')).click();
    await expectSignedOutScreen(page);
    await expectNoResidue(page);
  });

  test('on the lock screen, an account with no service gets the only-copy warning and the unlock-first hint instead of a backup button', async ({ page }) => {
    const address = email('lockedlocal');
    await signUpLocal(page, address);
    await createAccount(page, 'Everyday', '100.00');
    await lock(page);
    await page.getByRole('button', { name: 'Use a different account' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('signout-only-copy')).toContainText('only copy of this account');
    await expect(dialog.getByTestId('signout-lock-hint')).toContainText('cannot make a backup while the app is locked');
    await expect(dialog.getByRole('link', { name: 'Make a backup first' })).toHaveCount(0);
    await dialog.getByLabel(/^Type /).fill(address);
    await confirmButton(dialog).click();
    await expectSignedOutScreen(page);
    await expectNoResidue(page);
  });

  // ---- Language and accessibility (FR-016, SC-007) ----

  for (const [code, words] of [
    ['uk', { lock: 'Заблокувати', section: 'Вийти з облікового запису на цьому пристрої', open: 'Вийти', different: 'Скористатися іншим обліковим записом', signedOut: 'Ви вийшли' }],
    ['pl', { lock: 'Zablokuj', section: 'Wyloguj z tego urządzenia', open: 'Wyloguj', different: 'Użyj innego konta', signedOut: 'Jesteś wylogowany' }],
  ] as const) {
    test(`reads in ${code}: the section, the dialog, the lock-screen link and the signed-out screen, with no raw message key`, async ({ page, expectNoA11yViolations }) => {
      const raw = /\b(signout|signedout)\.[a-zA-Z_.]+/;
      await page.goto('/sign-up/');
      await chooseLanguage(page.getByLabel('Language'), code);
      const address = email('lang');
      await page.locator('input[type=email]').fill(address);
      const passwords = page.locator('input[type=password]');
      await passwords.nth(0).fill(PASSWORD);
      await passwords.nth(1).fill(PASSWORD);
      await page.locator('form button[type=submit]').click();
      await page.getByTestId('secret-key').waitFor({ timeout: 90_000 });
      await page.locator('[role=checkbox]').first().check();
      await page.locator('main button:not([disabled])').last().click();
      await page.getByTestId('current-fold').first().waitFor({ state: 'attached' });

      await go(page, 'Profile');
      await expect(page.getByRole('heading', { name: words.section })).toBeVisible();
      await page.getByRole('button', { name: words.open, exact: true }).click();
      expect(await page.getByRole('dialog').innerText()).not.toMatch(raw);
      await expectNoA11yViolations();
      // keyboard only: Cancel has the focus, Escape closes
      await expect(page.getByRole('dialog').getByRole('button').first()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await page.getByRole('button', { name: words.lock, exact: true }).click();
      await page.getByRole('button', { name: words.different }).click();
      expect(await page.getByRole('dialog').innerText()).not.toMatch(raw);
      await expectNoA11yViolations();
      await page.keyboard.press('Escape');
      await page.locator('input[type=password]').fill(PASSWORD);
      await page.locator('form button[type=submit]').click();
      await expect(page.getByTestId('current-fold').first()).toBeVisible({ timeout: 60_000 });
      await go(page, 'Profile');
      await page.getByRole('button', { name: words.open, exact: true }).click();
      await page.getByRole('dialog').getByRole('textbox').fill(address); // an account kept only on this device asks for its email
      await page.getByRole('dialog').getByRole('button').last().click();
      await expect(page.getByRole('heading', { name: words.signedOut })).toBeVisible({ timeout: 30_000 });
      expect(await page.locator('body').innerText()).not.toMatch(raw);
      await expectNoA11yViolations();
    });
  }
});

