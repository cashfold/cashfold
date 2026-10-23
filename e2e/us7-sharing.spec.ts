import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { cancelAdd, chooseFold, go, moreDetails, openAddTransaction } from './fixtures/nav.js';

// User story 7: share a Fold with other people (FR-083 to FR-089, FR-102, FR-104). Three real browsers on the real relay
// built from this checkout: each has its own account, its own encrypted database and its own keys.

const PASSWORD = 'correct horse battery staple';
const RELAY = `http://localhost:${Number(process.env['E2E_RELAY_PORT'] ?? 3200)}`;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;


/** A ledger screen on the shared Fold: people in two Folds choose which one they are looking at, in the sidebar. */
async function goIn(page: Page, name: string, fold = 'Household'): Promise<void> {
  await go(page, name);
  await chooseFold(page, fold, name);
}

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/sign-up/');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByLabel('Service address').fill(RELAY);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 90_000 });
  await page.getByLabel('I have saved my Secret Key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('current-fold')).toHaveText('Personal');
}

async function person(browser: Browser, prefix: string): Promise<{ context: BrowserContext; page: Page; email: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = `${prefix}+${unique()}@example.com`;
  await signUp(page, email);
  return { context, page, email };
}

async function addAccount(page: Page, name: string, opening: string, fold = 'Personal'): Promise<void> {
  await goIn(page, 'Accounts', fold);
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Opening balance (USD)').fill(opening);
  await moreDetails(dialog);
  await dialog.getByLabel('Opening date').fill('2020-01-01');
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function addExpense(page: Page, account: string, amount: string, note: string, daysAgo = 0): Promise<void> {
  await goIn(page, 'Transactions');
  await openAddTransaction(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Account').selectOption({ label: `${account} (USD)` });
  await dialog.getByLabel('Amount (USD)').fill(amount);
  await moreDetails(dialog);
  await dialog.getByLabel('Note').fill(note);
  if (daysAgo > 0) {
    const d = new Date(Date.now() - daysAgo * 86_400_000);
    const p = (n: number) => String(n).padStart(2, '0');
    await dialog.getByLabel('Date and time').fill(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T12:00`);
  }
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

const balanceOf = (page: Page, account: string) => page.getByTestId('account-row').filter({ hasText: account }).getByTestId('account-balance');
const rows = (page: Page, note: string) => page.getByTestId('tx-row').filter({ hasText: note });

/** Opens Folds and reads this person's fingerprint and invitation code. */
async function myCode(page: Page): Promise<{ fingerprint: string; code: string }> {
  await go(page, 'Folds');
  await expect(page.getByTestId('my-fingerprint')).toContainText(/\d{5}/, { timeout: 60_000 });
  const fingerprint = ((await page.getByTestId('my-fingerprint').textContent()) ?? '').replace(/\D/g, '');
  const code = ((await page.getByTestId('my-code').textContent()) ?? '').trim();
  expect(fingerprint).toHaveLength(40);
  return { fingerprint, code };
}

async function openSharing(page: Page, fold: string): Promise<void> {
  await go(page, 'Folds');
  await page.getByRole('button', { name: `Sharing ${fold}` }).click();
  await expect(page.getByRole('dialog').getByTestId('member-row').first()).toBeVisible({ timeout: 30_000 });
}

async function invite(page: Page, fold: string, how: { email: string } | { code: string }, theirFingerprint: string, opts: { role: string; scope: 'from_join' | 'full' }): Promise<void> {
  await openSharing(page, fold);
  await page.getByRole('button', { name: 'Invite someone' }).click();
  const dialog = page.getByRole('dialog').last();
  if ('email' in how) await dialog.getByLabel('Their email address').fill(how.email);
  else {
    await dialog.getByLabel('With their invitation code').check();
    await dialog.getByLabel('Their invitation code or link').fill(how.code);
  }
  await dialog.getByRole('button', { name: 'Find' }).click();
  await expect(dialog.getByTestId('their-fingerprint')).toBeVisible({ timeout: 30_000 });
  // The fingerprint shown is the one they read out: typing it is how the inviter confirms the keys are theirs.
  await expect(dialog.getByRole('button', { name: 'Send invitation' })).toBeDisabled();
  await dialog.getByLabel('Type what they read to you (optional)').fill(theirFingerprint);
  await expect(dialog.getByText('It matches.')).toBeVisible();
  await dialog.getByLabel('What can they do?').selectOption({ label: opts.role });
  await dialog.getByLabel(opts.scope === 'full' ? /^All history/ : /^From now on/).check();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('heading', { name: 'Invite someone' })).toHaveCount(0, { timeout: 60_000 });
  // The sharing panel stays open behind the invitation form; close it so the rest of the page can be reached.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: /^Sharing / })).toHaveCount(0);
}

async function accept(page: Page, inviterFingerprint: string): Promise<void> {

  await expect(async () => {
    await go(page, 'Accounts');
    await go(page, 'Folds');
    await expect(page.getByTestId('invitation-row')).toHaveCount(1, { timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
  const row = page.getByTestId('invitation-row');
  // what the invitee is shown is the inviter's own fingerprint, to be compared with what the inviter reads out
  expect(((await row.getByTestId('inviter-fingerprint').textContent()) ?? '').replace(/\D/g, '')).toBe(inviterFingerprint);
  await expect(row.getByRole('button', { name: 'Accept' })).toBeDisabled();
  await row.getByLabel(/I have compared this with/).check();
  await row.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByTestId('invitation-row')).toHaveCount(0, { timeout: 60_000 }).catch(async (e) => {
    throw new Error(`${e}\n--- page text ---\n${await page.locator('main').innerText()}`);
  });
}

test.describe('@us7 sharing', () => {
  test.use({ actionTimeout: 20_000 });
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });
  test.setTimeout(600_000);

  test('invites by address and by code, shows each person only what their invitation gives, enforces roles, and lets people be removed or leave', async ({ page, browser, expectNoA11yViolations }) => {
    // --- Alice has a Fold with history
    const aliceEmail = `alice+${unique()}@example.com`;
    await signUp(page, aliceEmail);
    await go(page, 'Folds');
    await page.getByRole('button', { name: 'Rename Personal' }).click();
    await page.getByLabel('Fold name').first().fill('Household');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByTestId('fold-name').filter({ hasText: 'Household' })).toBeVisible();
    // The shell reads the Fold's name again when the person moves to another screen, so wait for the new name rather than race it.
    await go(page, 'Overview');
    await expect(page.getByTestId('current-fold')).toHaveText('Household');
    await addAccount(page, 'Everyday', '1,000.00', 'Household');
    await addExpense(page, 'Everyday', '25.00', 'Old coffee', 10);
    const alice = await myCode(page);

    // --- Bob and Carol have accounts of their own
    const bob = await person(browser, 'bob');
    const carol = await person(browser, 'carol');
    const bobCode = await myCode(bob.page);
    const carolCode = await myCode(carol.page);
    await expectNoA11yViolations();

    // --- Alice invites Bob by address, as an editor, from now on
    await invite(page, 'Household', { email: bob.email }, bobCode.fingerprint, { role: 'Editor: can add and change entries', scope: 'from_join' });
    await accept(bob.page, alice.fingerprint);
    await go(bob.page, 'Folds');
    await expect(bob.page.getByTestId('fold-name').filter({ hasText: 'Household' })).toBeVisible({ timeout: 60_000 });
    await goIn(bob.page, 'Accounts');
    await expect(bob.page.getByRole('link', { name: 'Everyday', exact: true })).toBeVisible({ timeout: 60_000 });

    // Bob sees where the account stood the day he joined, and none of what came before (FR-102)
    await expect(balanceOf(bob.page, 'Everyday')).toHaveText('975.00 USD');
    await goIn(bob.page, 'Transactions');
    await expect(rows(bob.page, 'Old coffee')).toHaveCount(0);

    // --- what each writes reaches the other
    await addExpense(bob.page, 'Everyday', '10.00', 'Bob lunch');
    await go(page, 'Transactions');
    await expect(rows(page, 'Bob lunch')).toHaveCount(1, { timeout: 60_000 });
    await addExpense(page, 'Everyday', '5.00', 'Alice snack');
    await expect(rows(bob.page, 'Alice snack')).toHaveCount(1, { timeout: 60_000 });
    await go(page, 'Accounts');
    await goIn(bob.page, 'Accounts');
    await expect(balanceOf(page, 'Everyday')).toHaveText('960.00 USD');
    await expect(balanceOf(bob.page, 'Everyday')).toHaveText('960.00 USD').catch(async (e) => {
      throw new Error(`${e}\n--- bob page ---\nselected=${await bob.page.getByTestId('current-fold').textContent()}\n${await bob.page.locator('main').innerText()}`);
    });

    // --- a viewer can look and not change: the owner changes Bob's role, and Bob's next contact brings it
    await openSharing(page, 'Household');
    // members are listed in the order they joined, so the first one who is not Alice is Bob
    const bobRow = page.getByTestId('member-row').filter({ hasNotText: '(you)' }).first();
    await bobRow.getByRole('combobox').selectOption({ label: 'Viewer' });
    await expect(bobRow).toContainText('Viewer', { timeout: 30_000 });
    await expectNoA11yViolations();
    await page.keyboard.press('Escape');

    await expect(async () => {
      await goIn(bob.page, 'Transactions');
      await openAddTransaction(bob.page);
      const dialog = bob.page.getByRole('dialog');
      await dialog.getByLabel('Amount (USD)').fill('1.00');
      await moreDetails(dialog);
      await dialog.getByLabel('Note').fill('not allowed');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog.getByRole('alert')).toContainText('does not allow that', { timeout: 3_000 });
      await cancelAdd(bob.page, dialog);
    }).toPass({ timeout: 90_000 });

    // --- Alice invites Carol with her code and the whole history: Carol reads everything, and everyone is told
    await invite(page, 'Household', { code: carolCode.code }, carolCode.fingerprint, { role: 'Viewer: can only look', scope: 'full' });
    await accept(carol.page, alice.fingerprint);
    await goIn(carol.page, 'Transactions');
    await expect(rows(carol.page, 'Old coffee')).toHaveCount(1, { timeout: 60_000 });
    await expect(rows(carol.page, 'Bob lunch')).toHaveCount(1, { timeout: 60_000 });
    await openSharing(page, 'Household');
    await expect(page.getByTestId('notice-row')).toHaveCount(1);
    await expect(page.getByTestId('member-row')).toHaveCount(3);
    await page.keyboard.press('Escape');

    // --- Alice removes Bob: his device forgets the Fold at its next contact, with the plain statement of what that cannot undo
    await openSharing(page, 'Household');
    await bobRow.getByRole('button', { name: /^Remove / }).click();
    await expect(page.getByRole('dialog').last()).toContainText('cannot be taken back');
    await page.getByRole('dialog').last().getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByTestId('member-row')).toHaveCount(2, { timeout: 60_000 });
    await page.keyboard.press('Escape');
    await expect(async () => {
      await go(bob.page, 'Folds');
      await expect(bob.page.getByTestId('fold-removed-notice')).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 90_000 });
    await expect(bob.page.getByTestId('fold-name').filter({ hasText: 'Household' })).toHaveCount(0);

    // what is written after the removal still reaches Carol, under the new key
    await addExpense(page, 'Everyday', '2.00', 'After Bob');
    await expect(async () => {
      await goIn(carol.page, 'Transactions');
      await expect(rows(carol.page, 'After Bob')).toHaveCount(1, { timeout: 3_000 });
    }).toPass({ timeout: 90_000 });

    // --- Carol leaves: she is offered a copy first, and the Fold goes from her device
    await openSharing(carol.page, 'Household');
    await carol.page.getByRole('button', { name: 'Leave this Fold' }).click();
    await expect(carol.page.getByRole('dialog').last()).toContainText('cannot be taken back');
    const download = carol.page.waitForEvent('download');
    await carol.page.getByRole('button', { name: 'Download a copy first (CSV)' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    await carol.page.getByRole('dialog').last().getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(carol.page.getByTestId('fold-name').filter({ hasText: 'Household' })).toHaveCount(0, { timeout: 60_000 });

    await bob.context.close();
    await carol.context.close();
  });
});
