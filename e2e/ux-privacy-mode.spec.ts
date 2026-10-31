import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { createAccount, go, lock, moreDetails, signUpAndEnter, unlock } from './fixtures/nav.js';
import { choose, chooseAccount } from './fixtures/select.js';

// Privacy mode (spec 016): with the mode on no money figure can be read on any main screen or dialog, in the page text or in any label, title or
// description a screen reader would use, until one amount is revealed on purpose.

test.beforeEach(({ browserName }) => {
  test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
});

// The local date, as the app counts days (the UTC date can be another day late in the evening).
const PASSWORD = 'correct horse battery staple';
const today = new Date().toLocaleDateString('en-CA');
const inAYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
const firstOfMonth = `${today.slice(0, 8)}01`;

/** A figure with its currency (1,234.56 USD) or a signed number: what a person could read off the screen. */
const FIGURE = /\d[\d.,\s  ]*[.,]\d{2}\s?(USD|EUR|UAH|PLN)|[+−]\d/;

/** Every piece of text the page offers a reader: what is drawn, and the labels, titles and descriptions a screen reader or a tooltip would use. */
async function readable(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [document.title];
    const attributes = ['aria-label', 'aria-description', 'aria-valuetext', 'title', 'alt', 'placeholder'];
    for (const element of document.querySelectorAll('body *')) {
      for (const name of attributes) {
        const value = element.getAttribute(name);
        if (value !== null && value !== '') out.push(value);
      }
    }
    // The text on screen, outside form fields (a field legitimately shows what the person typed).
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent !== null && !['SCRIPT', 'STYLE', 'TEXTAREA', 'OPTION'].includes(parent.tagName) && (node.textContent ?? '').trim() !== '') out.push(node.textContent ?? '');
    }
    return out;
  });
}
async function figuresOnPage(page: Page): Promise<string[]> {
  return (await readable(page)).filter((text) => FIGURE.test(text));
}

async function addAccount(page: Page, name: string, opening: string, options: { currency?: string; kind?: string } = {}): Promise<void> {
  await go(page, 'Accounts');
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  if (options.kind) await choose(dialog.getByLabel('Kind'), options.kind);
  if (options.currency) await choose(dialog.getByLabel('Currency'), options.currency);
  await dialog.getByLabel(/^Opening balance/).fill(opening);
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** The sidebar's Add button opens the add sheet from any screen. */
async function openAddSheet(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
}

async function setUp(page: Page): Promise<void> {
  await signUpAndEnter(page);
  await createAccount(page, 'Checking', '1234.56');
  await addAccount(page, 'Euro wallet', '99.99', { currency: 'EUR' });
  await addAccount(page, 'Holiday fund', '0', { kind: 'Goal' });

  await openAddSheet(page);
  const tx = page.getByRole('dialog');
  await tx.getByLabel(/^Amount/).first().fill('12.50');
  await tx.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await go(page, 'Budgets');
  await page.getByRole('button', { name: 'Add budget', exact: true }).click();
  const budget = page.getByRole('dialog');
  await budget.getByLabel('Name', { exact: true }).fill('Groceries');
  await budget.getByLabel('Starting on').fill(firstOfMonth);
  await budget.getByLabel('Limit (USD)').fill('300.00');
  await budget.getByRole('button', { name: 'Create budget' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await go(page, 'Goals');
  await page.getByRole('button', { name: 'Add goal', exact: true }).click();
  const goal = page.getByRole('dialog');
  await goal.getByLabel('Name', { exact: true }).fill('Holiday');
  await chooseAccount(goal.getByLabel('Goal account'), 'Holiday fund');
  await goal.getByLabel('Target (USD)').fill('500.00');
  await goal.getByLabel('Target date').fill(inAYear);
  await goal.getByRole('button', { name: 'Create goal' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function turnOn(page: Page): Promise<void> {
  await go(page, 'Appearance');
  const toggle = page.getByTestId('privacy-mode-switch');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
}

const SCREENS = ['Overview', 'Accounts', 'Transactions', 'Budgets', 'Goals', 'Schedules', 'Data', 'Appearance'] as const;
const masked = (page: Page): Locator => page.locator('[role="button"][aria-label^="Hidden amount"]');

test.describe('@ux privacy mode', () => {
  test.setTimeout(300_000);

  test('hides every amount on every main screen, in labels and titles too, and shows one at a time on request (user story 1)', async ({ page, expectNoA11yViolations }) => {
    await setUp(page);

    // The scan itself works: with the mode off, the screens do show figures.
    await go(page, 'Accounts');
    expect((await figuresOnPage(page)).length).toBeGreaterThan(0);

    await turnOn(page);
    for (const screen of SCREENS) {
      await go(page, screen);
      await page.waitForTimeout(400);
      expect(await figuresOnPage(page), `readable figures on ${screen}`).toEqual([]);
    }

    // Dialogs that show money: the budget detail, and the preview of a CSV import.
    await go(page, 'Budgets');
    await page.getByRole('button', { name: 'Groceries', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.waitForTimeout(400);
    expect(await figuresOnPage(page), 'readable figures in the budget detail').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await go(page, 'Data');
    await page.locator('#import-file').setInputFiles({ name: 'bank.csv', mimeType: 'text/csv', buffer: Buffer.from(`Date,Amount,Note\n${today},-12.50,Coffee\n${today},1500.00,Salary\n`) });
    await page.getByRole('button', { name: 'Show what would be imported' }).click();
    await expect(page.getByTestId('import-preview')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    expect(await figuresOnPage(page), 'readable figures in the import preview').toEqual([]);
    await expect(page.getByTestId('import-preview')).toContainText('••••');

    // Names, dates and notes stay readable.
    await go(page, 'Accounts');
    await expect(page.getByRole('link', { name: 'Checking', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Euro wallet', exact: true })).toBeVisible();
    await go(page, 'Transactions');
    await expect(page.getByTestId('tx-row').first()).toBeVisible();
    // The mask keeps the currency code, and nothing says whether money came in or went out.
    await expect(page.getByTestId('tx-amount').first()).toContainText('•••• USD');
    await expect(page.getByTestId('tx-amount').first()).not.toHaveAttribute('data-sign', /.+/);
    await expect(page.getByTestId('tx-amount').first().locator('[data-sign]')).toHaveCount(0);

    // The account dropdown lists names only.
    await openAddSheet(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Account', { exact: true }).click();
    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();
    for (const option of await options.allTextContents()) expect(option).not.toMatch(/••••|\d[.,]\d{2}/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Reveal one amount by click: only that one, and it hides again by itself.
    await go(page, 'Accounts');
    const balances = page.getByTestId('account-balance');
    await expect(balances.first()).toContainText('••••');
    await balances.first().locator('[role="button"]').click();
    await expect(balances.first()).toContainText(/\d[.,]\d{2} (USD|EUR)/);
    await expect(balances.nth(1)).toContainText('••••');
    await expect(balances.first()).toContainText('••••', { timeout: 9_000 });

    // Leaving the screen hides it again.
    await balances.first().locator('[role="button"]').click();
    await expect(balances.first()).toContainText(/\d[.,]\d{2}/);
    await go(page, 'Overview');
    await go(page, 'Accounts');
    await expect(page.getByTestId('account-balance').first()).toContainText('••••');

    // The keyboard reveals too, and focus stays.
    const first = page.getByTestId('account-balance').first().locator('[role="button"]');
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('account-balance').first()).toContainText(/\d[.,]\d{2}/);
    await expect(page.getByTestId('account-balance').first().locator('span').first()).toBeFocused();

    // The page is still accessible with the mode on.
    await page.waitForTimeout(400);
    await expectNoA11yViolations();
    await expect(masked(page).first()).toBeVisible();
  });

  test('turns on and off with one key press, also while typing, shows the state, and does nothing when locked (user story 2)', async ({ page }) => {
    await signUpAndEnter(page);
    await createAccount(page, 'Checking', '1234.56');
    await go(page, 'Accounts');

    // The key the page expects: Command on an Apple system, Control elsewhere (an emulated browser can report another system than the host).
    const apple = await page.evaluate(() => /mac|iphone|ipad|ipod/i.test((navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform));
    const key = apple ? 'Meta+Shift+M' : 'Control+Shift+M';
    const balance = page.getByTestId('account-balance').first();
    const indicator = page.getByTestId('privacy-indicator');

    await expect(balance).toContainText(/\d[.,]\d{2} USD/);
    await expect(indicator).toHaveCount(0);
    await page.keyboard.press(key);
    await expect(balance).toContainText('•••• USD');
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText('Privacy mode on');
    await page.keyboard.press(key);
    await expect(balance).toContainText(/\d[.,]\d{2} USD/);
    await expect(indicator).toHaveCount(0);

    // Also while a text field has focus, and it types nothing.
    await go(page, 'Transactions');
    const search = page.getByRole('searchbox');
    await search.focus();
    await page.keyboard.press(key);
    await expect(indicator).toBeVisible();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();

    // The indicator turns it off again.
    await indicator.click();
    await expect(indicator).toHaveCount(0);

    // Locked, the key does nothing: the mode is what it was after unlocking.
    await page.keyboard.press(key);
    await expect(indicator).toBeVisible();
    await lock(page);
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
    await page.keyboard.press(key);
    await unlock(page, PASSWORD);
    await expect(page.getByTestId('current-fold').first()).toBeAttached();
    await expect(page.getByTestId('privacy-indicator')).toBeVisible();
  });

  test('notifications say nothing private by default, name the schedule when details are on, add the amount when amounts are on, and do not depend on Privacy mode (user story 3)', async ({ page }) => {
    await page.addInitScript(() => {
      const shown: Array<{ title: string; body: string }> = [];
      Object.assign(window, { __shown: shown, __permission: 'default', __notes: [] as unknown[] });
      // Both ways the page can show a notification are recorded; the service worker's is refused so the page's own (with a click handler) is used.
      class FakeNotification {
        static get permission() {
          return (window as unknown as { __permission: string }).__permission;
        }
        static requestPermission = async () => FakeNotification.permission;
        onclick: (() => void) | null = null;
        constructor(title: string, options?: { body?: string }) {
          shown.push({ title, body: options?.body ?? '' });
          (window as unknown as { __notes: unknown[] }).__notes.push(this);
        }
        close() {}
      }
      Object.assign(window, { Notification: FakeNotification });
      ServiceWorkerRegistration.prototype.showNotification = async () => {
        throw new Error('use the page notification');
      };
    });
    const shown = () => page.evaluate(() => (window as unknown as { __shown: Array<{ title: string; body: string }> }).__shown);
    const forget = () => page.evaluate(() => { localStorage.removeItem('cashfold.reminders.shown'); (window as unknown as { __shown: unknown[] }).__shown.length = 0; });
    const addSchedule = async (name: string, days: number) => {
      await go(page, 'Schedules');
      await page.getByRole('button', { name: 'Add schedule', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Name', { exact: true }).fill(name);
      await dialog.getByLabel('Amount (USD)').fill('400.00');
      const d = new Date();
      d.setDate(d.getDate() + days);
      await dialog.getByLabel('First on').fill(d.toLocaleDateString('en-CA'));
      await moreDetails(dialog);
      await choose(dialog.getByLabel('Reminder', { exact: true }), '1 day before');
      await dialog.getByRole('button', { name: 'Create schedule' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    const setSwitch = async (testid: string, on: boolean) => {
      const toggle = page.getByTestId(testid);
      if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', String(on));
    };

    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '1000.00');
    // The settings are off by default.
    await go(page, 'Appearance');
    await expect(page.getByTestId('notify-details-switch')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('notify-amounts-switch')).toHaveCount(0);

    // A reminder one day ahead, one day before: due now.
    await addSchedule('Rent', 1);
    await page.evaluate(() => Object.assign(window, { __permission: 'granted' }));
    // The next change of the ledger makes the reminder service look again.
    await createAccount(page, 'Savings', '10.00');
    await expect.poll(async () => (await shown()).length).toBe(1);
    const generic = (await shown())[0]!;
    expect(generic).toEqual({ title: 'Cashfold has a reminder', body: 'Open Cashfold to see it.' });
    expect(JSON.stringify(generic)).not.toMatch(/Rent|400|\d{4}/);

    // Choosing the notification brings the schedules up, as before.
    await go(page, 'Overview');
    await page.evaluate(() => (window as unknown as { __notes: Array<{ onclick: (() => void) | null }> }).__notes[0]!.onclick?.());
    await expect.poll(() => page.evaluate(() => location.pathname + location.search)).toBe('/plan/?view=schedules');

    // Details on: the schedule's name and the day, and no amount.
    await go(page, 'Appearance');
    await setSwitch('notify-details-switch', true);
    await forget();
    await createAccount(page, 'Third', '5.00');
    await expect.poll(async () => (await shown()).length).toBe(1);
    expect((await shown())[0]!.title).toBe('Due: Rent');
    expect((await shown())[0]!.body).toMatch(/^Scheduled for /);
    expect((await shown())[0]!.body).not.toMatch(/400/);

    // Amounts on as well: the amount appears, and it is the real figure with Privacy mode on.
    await go(page, 'Appearance');
    await setSwitch('notify-amounts-switch', true);
    await setSwitch('privacy-mode-switch', true);
    await forget();
    await createAccount(page, 'Fourth', '5.00').catch(() => undefined);
    await expect.poll(async () => (await shown()).length).toBeGreaterThan(0);
    expect((await shown())[0]!.body).toMatch(/400\.00 USD/);

    // Details off again: back to the generic text, with amounts still on underneath.
    await go(page, 'Appearance');
    await setSwitch('notify-details-switch', false);
    await forget();
    await createAccount(page, 'Fifth', '5.00').catch(() => undefined);
    await expect.poll(async () => (await shown()).length).toBeGreaterThan(0);
    expect((await shown())[0]).toEqual({ title: 'Cashfold has a reminder', body: 'Open Cashfold to see it.' });
  });

  test('both settings stay on this device: kept across a restart and a sign-out, never sent anywhere (user story 4)', async ({ page }) => {
    const email = 'privacy@example.com';
    const sent: string[] = [];
    page.on('request', (request) => void sent.push(`${request.url()} ${request.postData() ?? ''}`));

    // An account kept only on this device.
    await page.goto('/sign-up/');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByLabel('Keep everything on this device for now').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 90_000 });
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('current-fold')).toHaveText('Personal');

    await go(page, 'Appearance');
    await expect(page.getByTestId('privacy-mode-switch')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('notify-details-switch')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('privacy-mode-switch').click();
    await page.getByTestId('notify-details-switch').click();
    await expect(page.getByTestId('privacy-mode-switch')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('notify-details-switch')).toHaveAttribute('aria-checked', 'true');

    // They live in the interface preferences of this device and nowhere else.
    const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem('cashfold.ui') ?? '{}') as { privacyMode?: boolean; notificationDetails?: string });
    expect(await prefs()).toMatchObject({ privacyMode: true, notificationDetails: 'on' });
    expect(sent.filter((line) => /privacyMode|notificationDetails/.test(line))).toEqual([]);

    // A restart keeps them.
    await page.reload();
    await unlock(page, PASSWORD);
    await expect(page.getByTestId('current-fold').first()).toBeAttached();
    await go(page, 'Appearance');
    await expect(page.getByTestId('privacy-mode-switch')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('notify-details-switch')).toHaveAttribute('aria-checked', 'true');

    // So does signing out, which erases the account but not what belongs to the device.
    await go(page, 'Profile');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Type /).fill(email);
    await dialog.getByRole('button', { name: /^Sign out and erase/ }).click();
    await expect(page.getByRole('heading', { name: 'You are signed out' })).toBeVisible({ timeout: 30_000 });
    expect(await prefs()).toMatchObject({ privacyMode: true, notificationDetails: 'on' });
    expect(sent.filter((line) => /privacyMode|notificationDetails/.test(line))).toEqual([]);
  });

  test('forms, exports and copying give real figures with the mode on (user story 5)', async ({ page }) => {
    await setUp(page);

    const exportCsv = async (): Promise<string> => {
      await go(page, 'Data');
      const region = page.getByRole('region', { name: 'Export to CSV' });
      await region.getByLabel(/password/i).fill(PASSWORD);
      const [download] = await Promise.all([page.waitForEvent('download'), region.getByRole('button', { name: 'Export', exact: true }).click()]);
      return readFileSync((await download.path())!, 'utf8');
    };
    const withoutMode = await exportCsv();
    expect(withoutMode).toMatch(/12\.50/);

    await turnOn(page);
    // A printed screen follows the screen: masked amounts stay masked on paper, and the export is said to be the way to real figures.
    for (const screen of ['Overview', 'Transactions'] as const) {
      await go(page, screen);
      await page.emulateMedia({ media: 'print' });
      await page.waitForTimeout(400);
      expect(await figuresOnPage(page), `readable figures when printing ${screen}`).toEqual([]);
      await page.emulateMedia({ media: 'screen' });
    }
    await go(page, 'Data');
    await expect(page.getByTestId('export-real-figures')).toContainText('always use real figures');

    // The export is the same file with the mode on: real figures, nothing masked.
    const withMode = await exportCsv();
    expect(withMode).toBe(withoutMode);
    expect(withMode).not.toContain('••••');

    // The edit forms show the real figure.
    await go(page, 'Transactions');
    await page.getByTestId('tx-row').first().getByRole('button').first().click();
    const edit = page.getByRole('dialog');
    await expect(edit.getByLabel(/^Amount/).first()).toHaveValue('12.50');
    await edit.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click({ timeout: 2_000 }).catch(() => undefined);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await go(page, 'Budgets');
    await page.getByRole('button', { name: 'Edit Groceries' }).click();
    await expect(page.getByRole('dialog').getByLabel('Limit (USD)')).toHaveValue('300.00');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await go(page, 'Goals');
    await page.getByRole('button', { name: 'Edit Holiday' }).click();
    await expect(page.getByRole('dialog').getByLabel('Target (USD)')).toHaveValue('500.00');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // What is typed is what is saved: add 7.77, then reveal it in the list.
    await openAddSheet(page);
    const add = page.getByRole('dialog');
    await add.getByLabel(/^Amount/).first().fill('7.77');
    await expect(add.getByLabel(/^Amount/).first()).toHaveValue('7.77');
    await add.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await go(page, 'Transactions');
    const rows = page.getByTestId('tx-row');
    const newest = rows.filter({ has: page.locator('[data-testid=tx-amount]') }).first();
    await expect(newest.getByTestId('tx-amount')).toContainText('••••');
    await newest.getByTestId('tx-amount').locator('[role="button"]').click();
    await expect(newest.getByTestId('tx-amount')).toContainText(/7\.77|12\.50/);

    // Copying: what is selected on a masked amount holds no figure; once shown, it holds the figure.
    await go(page, 'Accounts');
    const balance = page.getByTestId('account-balance').first();
    const selected = () => page.evaluate(() => window.getSelection()?.toString() ?? '');
    await balance.locator('[role="button"]').evaluate((el) => { const range = document.createRange(); range.selectNodeContents(el); const s = window.getSelection()!; s.removeAllRanges(); s.addRange(range); });
    expect(await selected()).toBe('•••• USD');
    expect(await selected()).not.toMatch(/\d/);
    await balance.locator('[role="button"]').click();
    await balance.locator('span').first().evaluate((el) => { const range = document.createRange(); range.selectNodeContents(el); const s = window.getSelection()!; s.removeAllRanges(); s.addRange(range); });
    expect(await selected()).toMatch(/^\d[\d,]*\.\d{2} USD$/);
  });
});

