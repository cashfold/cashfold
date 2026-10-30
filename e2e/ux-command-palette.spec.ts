import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { createAccount, go, signUpAndEnter, unlock } from './fixtures/nav.js';
import { choose, chooseAccount } from './fixtures/select.js';

// The command palette (spec 015): ⌘K / Ctrl+K opens a modal search that jumps to accounts, budgets, goals and screens and runs common actions, keeps a
// device-local Recent and Frequent list, and is never there while the app is locked.

const PASSWORD = 'correct horse battery staple';

/** The key the page expects: Command on an Apple system, Control elsewhere. The page's own answer is used because an emulated browser can report another system than the host. */
async function openKey(page: Page): Promise<string> {
  const apple = await page.evaluate(() => /mac|iphone|ipad|ipod/i.test((navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform));
  return apple ? 'Meta+K' : 'Control+K';
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' });
const box = (page: Page) => dialog(page).getByRole('combobox');
const options = (page: Page) => dialog(page).getByRole('option');
const today = new Date().toISOString().slice(0, 10);
const inAYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
const firstOfMonth = `${today.slice(0, 8)}01`;

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press(await openKey(page));
  // The dialog element itself is a zero-size wrapper; what is on screen is the field inside it.
  await expect(box(page)).toBeVisible();
  await expect(box(page)).toBeFocused();
}

/** Budgets and goals are read when the palette opens; Enter acts on the row shown, so a test that wants one of them waits for the reading to end. */
async function loaded(page: Page): Promise<void> {
  await expect(dialog(page)).not.toContainText('More results are loading');
}

async function closed(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, undefined, { timeout: 5_000 });
}

async function addGoalAccount(page: Page, name: string): Promise<void> {
  await go(page, 'Accounts');
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name', { exact: true }).fill(name);
  await choose(d.getByLabel('Kind'), 'Goal');
  await d.getByLabel(/^Opening balance/).fill('0');
  await d.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('@ux command palette', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });
  test.setTimeout(300_000);

  test('jumps to an account, a budget, a goal and a screen from the keyboard, in five keystrokes for an account (user stories 1 and 4)', async ({ page, expectNoA11yViolations }) => {
    await signUpAndEnter(page);
    await createAccount(page, 'Checking', '100.00');
    await createAccount(page, 'Café', '20.00');
    await addGoalAccount(page, 'Holiday fund');

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

    // An account in five keystrokes: the shortcut, three letters, Enter (SC-001).
    await go(page, 'Overview');
    await openPalette(page);
    await expect(box(page)).toHaveAttribute('placeholder', /(⌘K|Ctrl\+K)/);
    await page.waitForTimeout(400); // the panel's fade-in, so axe does not measure half-faded colours
    await expectNoA11yViolations();
    await page.keyboard.type('chk');
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText('Checking');
    await page.keyboard.press('Enter');
    await closed(page);
    await expect.poll(() => page.evaluate(() => location.pathname + location.search)).toMatch(/^\/transactions\/\?account=/);

    // Case and accents are ignored.
    await openPalette(page);
    await page.keyboard.type('CAFE');
    await expect(options(page).first()).toContainText('Café');
    await page.keyboard.press('Escape');
    await closed(page);

    // A budget and a goal open the Plan tab with the row focused.
    await openPalette(page);
    await page.keyboard.type('groc');
    await loaded(page);
    await expect(options(page).first()).toContainText('Groceries');
    await page.keyboard.press('Enter');
    await closed(page);
    await expect(page.getByTestId('budget-row').filter({ hasText: 'Groceries' })).toBeFocused();
    await expect.poll(() => page.evaluate(() => location.search)).not.toContain('item=');

    await openPalette(page);
    await page.keyboard.type('holi');
    await loaded(page);
    await expect(options(page).first()).toContainText('Goal');
    await page.keyboard.press('Enter');
    await closed(page);
    await expect(page.getByTestId('goal-row').filter({ hasText: 'Holiday' })).toBeFocused();

    // A screen, found by a word that is not in its name.
    await openPalette(page);
    await page.keyboard.type('csv');
    await page.keyboard.press('Enter');
    await closed(page);
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/settings/data/');

    // No match: a message, and Enter does nothing.
    await openPalette(page);
    await page.keyboard.type('zzzz');
    await expect(dialog(page)).toContainText('No results');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(1);
    await page.waitForTimeout(400); // the panel's fade-in, so axe does not measure half-faded colours
    await expectNoA11yViolations();
    await page.keyboard.press(await openKey(page));
    await closed(page);
  });

  test('gives focus back, runs actions, remembers what was used on this device, and is gone when locked (user stories 2, 3 and 4)', async ({ page }) => {
    await signUpAndEnter(page);
    await createAccount(page, 'Checking', '100.00');
    await go(page, 'Transactions');

    // Escape puts the cursor back where it was.
    const search = page.getByRole('searchbox');
    await search.focus();
    await openPalette(page);
    await page.keyboard.press('Escape');
    await closed(page);
    await expect(search).toBeFocused();

    // An action does what its control does: Add transaction opens the add sheet.
    await openPalette(page);
    await page.keyboard.type('add trans');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('dialog').getByLabel(/^Amount/).first()).toBeVisible();
    // The palette does not open over another dialog.
    await page.keyboard.press(await openKey(page));
    await expect(dialog(page)).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await closed(page);

    // Switch theme.
    const theme = () => page.evaluate(() => document.documentElement.dataset['theme']);
    const before = await theme();
    await openPalette(page);
    await page.keyboard.type('switch theme');
    await page.keyboard.press('Enter');
    await closed(page);
    await expect.poll(theme).not.toBe(before);

    // Sign out only opens the usual confirmation.
    await openPalette(page);
    await page.keyboard.type('sign out');
    await page.keyboard.press('Enter');
    const signOut = page.getByRole('dialog', { name: /^Sign out of this device/ });
    await expect(signOut).toHaveCount(1);
    await expect(dialog(page)).toHaveCount(0);
    await signOut.getByRole('button', { name: 'Cancel' }).click();
    await closed(page);

    // What was used is remembered on this device, as ids and counts only.
    await openPalette(page);
    await expect(dialog(page).getByText('Recent', { exact: true })).toBeVisible();
    await expect(options(page).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await closed(page);
    const stored = await page.evaluate(() => localStorage.getItem('cashfold.palette'));
    expect(stored).not.toBeNull();
    expect(stored).not.toMatch(/Checking|Switch|Sign out|add trans/);
    expect(Object.keys(JSON.parse(stored!).items[0]).sort()).toEqual(['id', 'n', 't']);

    // Clearing it in Settings empties Recent and Frequent.
    await go(page, 'Data');
    await page.getByTestId('palette-history-clear').click();
    await expect(page.getByRole('status').filter({ hasText: 'Palette history cleared' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('cashfold.palette'))).toBeNull();
    await openPalette(page);
    await expect(dialog(page).getByText('Recent', { exact: true })).toHaveCount(0);
    await expect(dialog(page).getByText('Screens', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await closed(page);

    // The privacy cover (the window was left) takes the palette away, so no name stays on screen under it.
    await go(page, 'Overview');
    await openPalette(page);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.getByTestId('privacy-cover')).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await closed(page);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('privacy-cover')).toHaveCount(0);

    // "Lock now" locks like the Lock control; while locked the shortcut does nothing and no name is shown.
    await openPalette(page);
    await page.keyboard.type('lock now');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await page.keyboard.press(await openKey(page));
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText('Checking')).toHaveCount(0);
    await unlock(page, PASSWORD);
    await expect(page.getByTestId('current-fold').first()).toBeAttached();
  });

  test('fits a narrow window without scrolling sideways, and a long name stays whole for a screen reader (edge cases)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await signUpAndEnter(page);
    const long = 'A very long account name that goes past the width of a small phone';
    await createAccount(page, long, '10.00');
    await openPalette(page);
    await page.keyboard.type('very long');
    await expect(options(page)).toHaveCount(1);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const row = options(page).first();
    expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(row).toContainText(long);
  });
});
