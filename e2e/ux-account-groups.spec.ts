import type { Browser, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { accountAction, go, lock, moreDetails, signUpAndEnter, unlock } from './fixtures/nav.js';

// Account groups on the Accounts page (spec 012): sections by group with exact subtotals, a switch between "By group" and "By type" that is
// remembered on the device, one-step moving from an account's menu, and groups managed in plain view.

const PASSWORD = 'correct horse battery staple';

async function addGroup(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Group name').fill(name);
  await dialog.getByRole('button', { name: 'Add group', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function addAccount(page: Page, name: string, opening: string, options: { currency?: string; group?: string } = {}): Promise<void> {
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  if (options.currency) await dialog.getByLabel('Currency').selectOption(options.currency);
  await dialog.getByLabel(/^Opening balance/).fill(opening);
  if (options.group) {
    await moreDetails(dialog);
    await dialog.getByLabel('Group', { exact: true }).selectOption({ label: options.group });
  }
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

const section = (page: Page, name: string): Locator => page.getByRole('region', { name, exact: true });
const names = async (scope: Locator): Promise<string[]> =>
  (await scope.getByTestId('account-row').getByRole('link').allTextContents()).map((s) => s.trim());
const storedView = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('cashfold.ui') ?? '{}').lists?.accountsView);

async function relock(page: Page): Promise<void> {
  await page.reload();
  await unlock(page, PASSWORD);
  await go(page, 'Accounts');
}

test.describe('@ux account groups', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });
  test.setTimeout(300_000);

  test('shows each group with an exact subtotal, and the rest under Ungrouped (user story 1)', async ({ page }) => {
    await signUpAndEnter(page);
    await go(page, 'Accounts');
    await addGroup(page, 'Household');
    await addGroup(page, 'Travel');
    await addGroup(page, 'Empty');
    await addAccount(page, 'Alpha', '100.00', { group: 'Household' });
    await addAccount(page, 'Beta', '50.50', { group: 'Household' });
    await addAccount(page, 'Wallet', '20.00', { currency: 'EUR', group: 'Travel' });
    await addAccount(page, 'Card', '10.00', { group: 'Travel' });
    await addAccount(page, 'Loose', '5.00');

    // Opened by group once an account is grouped, with the name as a heading.
    await expect(page.getByRole('heading', { level: 2, name: 'Household' })).toBeVisible();
    const household = section(page, 'Household');
    expect(await names(household)).toEqual(['Alpha', 'Beta']);
    await expect(household.getByTestId('group-subtotal')).toContainText('Subtotal, Household');
    await expect(household.getByTestId('group-subtotal')).toContainText('150.50 USD');

    // Two currencies are two amounts and never a combined figure.
    const travel = section(page, 'Travel');
    await expect(travel.getByTestId('group-subtotal').locator('[data-sign]')).toHaveCount(2);
    await expect(travel.getByTestId('group-subtotal')).toContainText('20.00 EUR');
    await expect(travel.getByTestId('group-subtotal')).toContainText('10.00 USD');

    const empty = section(page, 'Empty');
    await expect(empty).toContainText('No accounts in this group yet');
    await expect(empty.getByTestId('group-subtotal')).toHaveCount(0);

    const loose = section(page, 'Ungrouped');
    expect(await names(loose)).toEqual(['Loose']);

    // Archived accounts are neither listed nor counted while the switch is off.
    await accountAction(page, 'Beta', 'Archive');
    await expect(page.getByRole('link', { name: 'Beta', exact: true })).toHaveCount(0);
    await expect(household.getByTestId('group-subtotal')).toContainText('100.00 USD');
    await page.getByLabel('Show archived accounts').check();
    await expect(page.getByRole('link', { name: 'Beta', exact: true })).toBeVisible();
    await expect(household.getByTestId('group-subtotal')).toContainText('150.50 USD');

    // Moving down swaps with the account below it in the same group.
    await accountAction(page, 'Alpha', 'Move Alpha down');
    await expect.poll(() => names(household)).toEqual(['Beta', 'Alpha']);

    // No Ungrouped heading when every account is in a group.
    await accountAction(page, 'Loose', 'Move to Travel');
    await expect(page.getByRole('heading', { level: 2, name: 'Ungrouped' })).toHaveCount(0);
  });

  test('switches between By group and By type, and remembers the choice (user story 2)', async ({ page, expectNoA11yViolations }) => {
    await signUpAndEnter(page);
    await go(page, 'Accounts');
    // No group: the page is by type, there is no switch, and one line says what groups are for beside "Add group".
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add group', exact: true })).toBeVisible();
    await expect(page.getByText('Groups keep related accounts together.')).toBeVisible();
    await addAccount(page, 'Alpha', '10.00');
    await expect(page.getByRole('heading', { level: 2, name: 'Checking' })).toBeVisible();

    // A group with no account in it: still by type, with the switch.
    await addGroup(page, 'Household');
    await expect(page.getByRole('radiogroup', { name: 'View' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Checking' })).toBeVisible();

    // Moving the first account into a group opens the page by group from then on (never chosen).
    await accountAction(page, 'Alpha', 'Move to Household');
    await expect(page.getByRole('heading', { level: 2, name: 'Household' })).toBeVisible();
    expect((await storedView(page)) ?? 'auto').toBe('auto'); // never written until a choice is made
    await relock(page);
    await expect(page.getByRole('radio', { name: 'By group' })).toBeChecked();
    await expectNoA11yViolations();

    // Choosing By type survives a reload and a lock, even though accounts are grouped.
    await page.getByRole('radio', { name: 'By type' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Checking' })).toBeVisible();
    expect(await storedView(page)).toBe('type');
    await expectNoA11yViolations();
    await relock(page);
    await expect(page.getByRole('radio', { name: 'By type' })).toBeChecked();
    await go(page, 'Overview');
    await lock(page);
    await unlock(page, PASSWORD);
    await go(page, 'Accounts');
    await expect(page.getByRole('radio', { name: 'By type' })).toBeChecked();

    // Choosing By group is kept too, and the switch works with the keyboard.
    await page.getByRole('radio', { name: 'By type' }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('radio', { name: 'By group' })).toBeChecked();
    await relock(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Household' })).toBeVisible();
    expect(await storedView(page)).toBe('group');
  });

  test('shows an account\'s group and moves it in one step (user story 3)', async ({ page, expectNoA11yViolations }) => {
    await signUpAndEnter(page);
    await go(page, 'Accounts');
    await addGroup(page, 'Household');
    await addGroup(page, 'Savings');
    await addAccount(page, 'Alpha', '100.00', { group: 'Household' });
    await addAccount(page, 'Beta', '40.00');
    await page.getByRole('radio', { name: 'By type' }).click();

    // Type view: the group is a label on the account, and an ungrouped account has none.
    const alpha = page.getByTestId('account-row').filter({ hasText: 'Alpha' });
    const beta = page.getByTestId('account-row').filter({ hasText: 'Beta' });
    await expect(alpha.getByTestId('account-group')).toHaveText('Group: Household');
    await expect(beta.getByTestId('account-group')).toHaveCount(0);

    // The menu lists every group and Ungrouped; the current one is disabled and marked.
    await page.getByRole('button', { name: 'Actions for Alpha' }).click();
    await expect(page.getByRole('menuitem', { name: 'Household (current group)' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Move to Savings' })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Move to Ungrouped' })).toBeEnabled();
    await expectNoA11yViolations();
    await page.getByRole('menuitem', { name: 'Move to Savings' }).click();
    await expect(alpha.getByTestId('account-group')).toHaveText('Group: Savings');
    await expect(page.getByRole('status').filter({ hasText: 'Moved to Savings' })).toBeVisible();
    // Focus stays on the account's menu button.
    await expect(page.getByRole('button', { name: 'Actions for Alpha' })).toBeFocused();

    // Its form shows the new group.
    await accountAction(page, 'Alpha', 'Edit');
    await moreDetails(page.getByRole('dialog'));
    await expect(page.getByRole('dialog').getByLabel('Group', { exact: true })).toHaveValue(/.+/);
    await expect(page.getByRole('dialog').getByLabel('Group', { exact: true }).locator('option:checked')).toHaveText('Savings');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    // Group view: the account appears in its new section, and the subtotals change.
    await page.getByRole('radio', { name: 'By group' }).click();
    expect(await names(section(page, 'Savings'))).toEqual(['Alpha']);
    await expect(section(page, 'Savings').getByTestId('group-subtotal')).toContainText('100.00 USD');
    await accountAction(page, 'Alpha', 'Move to Ungrouped');
    await expect(section(page, 'Savings')).toContainText('No accounts in this group yet');
    expect(await names(section(page, 'Ungrouped'))).toEqual(['Alpha', 'Beta']);
    await expect(page.getByRole('status').filter({ hasText: 'Moved out of its group' })).toBeVisible();

    // Moving up and down in the group view, then the type view agrees.
    await accountAction(page, 'Alpha', 'Move Alpha down');
    await expect.poll(() => names(section(page, 'Ungrouped'))).toEqual(['Beta', 'Alpha']);
    await page.getByRole('radio', { name: 'By type' }).click();
    expect(await names(page.getByRole('region', { name: 'Checking' }))).toEqual(['Beta', 'Alpha']);
  });

  test('keeps the group menu reachable with twenty groups (user story 3)', async ({ page, expectNoA11yViolations }) => {
    await signUpAndEnter(page);
    await go(page, 'Accounts');
    await addAccount(page, 'Alpha', '1.00');
    for (let i = 1; i <= 20; i++) await addGroup(page, `Group ${String(i).padStart(2, '0')}`);
    await page.getByRole('button', { name: 'Actions for Alpha' }).click();
    const last = page.getByRole('menuitem', { name: 'Move to Group 20' });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expectNoA11yViolations();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowUp'); // the last item is Delete; walk back to the group entry with the keyboard
    await last.click();
    await expect(page.getByRole('status').filter({ hasText: 'Moved to Group 20' })).toBeVisible();
  });

  test('creates, renames and deletes groups where they are shown (user story 4)', async ({ page, expectNoA11yViolations }) => {
    await signUpAndEnter(page);
    await go(page, 'Accounts');
    await expect(page.getByRole('button', { name: 'Add group', exact: true })).toBeVisible();
    await addGroup(page, 'Household');
    await addGroup(page, 'Travel');
    await expect(page.getByRole('button', { name: 'Add group', exact: true })).toBeVisible();

    // Refused names show a reason and save nothing.
    await page.getByRole('button', { name: 'Add group', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Group name').fill('   ');
    await dialog.getByRole('button', { name: 'Add group', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('1 to 80 characters');
    await dialog.getByLabel('Group name').fill(' household ');
    await dialog.getByRole('button', { name: 'Add group', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('A group with this name already exists.');
    await dialog.getByLabel('Group name').fill('x'.repeat(81));
    expect((await dialog.getByLabel('Group name').inputValue()).length).toBe(80); // the field stops at 80 characters
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await addAccount(page, 'Alpha', '100.00', { group: 'Household' });
    await addAccount(page, 'Beta', '25.00', { group: 'Household' });
    // Budgets: one limited to the group only, one to the group and an account.
    await go(page, 'Budgets');
    for (const [name, withAccount] of [['Food', false], ['Mixed', true]] as const) {
      await page.getByRole('button', { name: 'Add budget', exact: true }).click();
      const form = page.getByRole('dialog');
      await form.getByLabel('Name', { exact: true }).fill(name);
      await form.getByLabel('Limit (USD)').fill('300.00');
      await moreDetails(form);
      await form.getByLabel('Groups').selectOption({ label: 'Household' });
      if (withAccount) await form.getByLabel('Accounts', { exact: true }).selectOption({ label: 'Alpha' });
      await form.getByRole('button', { name: 'Create budget' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await go(page, 'Accounts');

    // Rename updates the heading and every account's label.
    await section(page, 'Household').getByRole('button', { name: 'Rename group: Household' }).click();
    await page.getByRole('dialog').getByLabel('Group name').fill('Home');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Home' })).toBeVisible();
    await page.getByRole('radio', { name: 'By type' }).click();
    await expect(page.getByTestId('account-group')).toHaveText(['Group: Home', 'Group: Home']);
    // The type view lists the groups in plain view, with the same actions.
    await expect(page.getByRole('button', { name: 'Delete group: Travel' })).toBeVisible();
    await page.getByRole('radio', { name: 'By group' }).click();

    // Delete says what is kept and what the budgets will do, with Cancel in focus.
    await section(page, 'Home').getByRole('button', { name: 'Delete group: Home' }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText('Delete the group “Home”?');
    await expect(confirm).toContainText('2 accounts are in this group. They are kept and shown as ungrouped.');
    await expect(confirm).toContainText('Budgets limited to this group: Mixed.');
    await expect(confirm).toContainText('will count nothing afterwards: Food.');
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expectNoA11yViolations();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(section(page, 'Home')).toBeVisible();

    await section(page, 'Home').getByRole('button', { name: 'Delete group: Home' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete group', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Home' })).toHaveCount(0);
    const loose = section(page, 'Ungrouped');
    expect(await names(loose)).toEqual(['Alpha', 'Beta']);
    await expect(loose.getByTestId('group-subtotal')).toContainText('125.00 USD');
  });

  test('keeps long names and the subtotal inside a narrow screen (polish)', async ({ page, expectNoA11yViolations }) => {
    test.skip(test.info().project.name !== 'chromium', 'one project is enough');
    await signUpAndEnter(page);
    await go(page, 'Accounts');
    const long = 'A very long group name that goes on and on without any sensible place to stop ' + 'x'.repeat(60);
    await addGroup(page, long.slice(0, 80));
    await addGroup(page, 'Travel');
    await addAccount(page, 'Alpha', '12345678.90', { group: long.slice(0, 80) });
    await expectNoA11yViolations();
    await page.setViewportSize({ width: 360, height: 740 });
    const subtotal = section(page, long.slice(0, 80)).getByTestId('group-subtotal');
    await subtotal.scrollIntoViewIfNeeded();
    const box = (await subtotal.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: 'Add group', exact: true })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'View' })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  for (const [code, words] of [
    ['uk', { addGroup: 'Додати групу', view: 'За групами', empty: 'У цій групі ще немає рахунків', title: 'Видалити групу', ungrouped: 'Без групи' }],
    ['pl', { addGroup: 'Dodaj grupę', view: 'Według grup', empty: 'W tej grupie nie ma jeszcze kont', title: 'Usuń grupę', ungrouped: 'Bez grupy' }],
  ] as const) {
    test.describe(`browser language ${code}`, () => {
      test.use({ locale: code });
      test(`reads in ${code} with no raw message key (polish)`, async ({ page, expectNoA11yViolations }) => {
        test.skip(test.info().project.name !== 'chromium', 'one project is enough');
        const RAW_KEY = /\b(ledger\.(groups|accounts)|status\.account(Moved|Ungrouped))\.[a-zA-Z_.]+/;
        await signUpAndEnter(page);
        await go(page, 'Accounts');
        await page.getByRole('button', { name: words.addGroup, exact: true }).first().click();
        await page.getByRole('dialog').getByRole('textbox').fill('Dom');
        await expectNoA11yViolations();
        await page.getByRole('dialog').getByRole('textbox').press('Enter');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.getByRole('radio', { name: words.view }).check();
        await expect(page.getByText(words.empty)).toBeVisible();
        await page.getByRole('button', { name: /Dom$/ }).last().click();
        await expect(page.getByRole('dialog')).toContainText(words.title.split(' ')[0]!);
        expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);
        await expectNoA11yViolations();
      });
    });
  }

  test('a rename and a delete made on one device reach another (user story 4, sync)', async ({ page, browser }) => {
    const RELAY = `http://localhost:${Number(process.env['E2E_RELAY_PORT'] ?? 3200)}`;
    const email = `alice+${Date.now().toString(36)}@example.com`;
    await page.goto('/sign-up/');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByLabel('Keep everything on this device for now').uncheck();
    await page.getByLabel('Service address').fill(RELAY);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 90_000 });
    const key = (await page.getByTestId('secret-key').textContent())!.trim();
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('current-fold')).toHaveText('Personal');
    await go(page, 'Accounts');
    await addGroup(page, 'Household');
    await addAccount(page, 'Alpha', '100.00', { group: 'Household' });
    await expect(page.locator('[data-sync-state]')).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });

    const second = await enrolSecond(browser, email, key, RELAY);
    await go(second.page, 'Accounts');
    await expect(section(second.page, 'Household')).toBeVisible({ timeout: 60_000 });

    await section(page, 'Household').getByRole('button', { name: 'Rename group: Household' }).click();
    await page.getByRole('dialog').getByLabel('Group name').fill('Home');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[data-sync-state]')).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });
    await expect(section(second.page, 'Home')).toBeVisible({ timeout: 60_000 });

    await section(page, 'Home').getByRole('button', { name: 'Delete group: Home' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete group', exact: true }).click();
    await expect(page.locator('[data-sync-state]')).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });
    // With no group left the page opens by type, where the account is listed and reads as ungrouped.
    await expect(second.page.getByTestId('account-row').filter({ hasText: 'Alpha' })).toBeVisible({ timeout: 60_000 });
    await expect(second.page.getByTestId('account-group')).toHaveCount(0);
    await expect(second.page.getByRole('heading', { level: 2, name: 'Home' })).toHaveCount(0);
    await second.context.close();
  });
});

async function enrolSecond(browser: Browser, email: string, key: string, server: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/add/#${new URLSearchParams({ email, server, key }).toString()}`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Add this device' }).click();
  await expect(page).toHaveURL(/\/overview\/$/, { timeout: 90_000 });
  return { context, page };
}
