import { expect, type Page } from '@playwright/test';

// Navigation helper for the specs. It takes the names of the screens as people knew them before the redesign and follows the new structure
// in the app (no page reload, so the app stays unlocked): five sidebar entries, Plan tabs and the Settings groups.

// Navigation helper for the specs. It takes the names of the screens as people knew them before the redesign and follows the new structure
// in the app (no page reload, so the app stays unlocked): five sidebar entries, Plan tabs and the Settings groups. It addresses links by their
// route, not by their text, so it works in every language (the pseudo-locale project included).

const PLAN_TABS: Record<string, number> = { Budgets: 0, Goals: 1, Schedules: 2 };
const SECTIONS: Record<string, string> = { Dashboard: '/overview/', Overview: '/overview/', Transactions: '/transactions/', Transfers: '/transactions/', Accounts: '/accounts/', Plan: '/plan/', Settings: '/settings/' };
const SETTINGS_GROUPS: Record<string, string> = {
  Categories: '/settings/categories/',
  Folds: '/settings/folds/',
  Data: '/settings/data/',
  Devices: '/settings/sync/',
  Profile: '/settings/profile/',
  Appearance: '/settings/appearance/',
  Advanced: '/settings/advanced/',
  Desktop: '/settings/desktop/',
};

export async function go(page: Page, name: string): Promise<void> {
  const primary = async (href: string) => {
    // Let a drawer that is still closing finish, so its links are not mistaken for the desktop navigation.
    await page.waitForFunction(() => document.querySelector('[data-leave],[data-closed]') === null, undefined, { timeout: 5_000 }).catch(() => undefined);
    const visible = page.locator(`nav a[href="${href}"]:visible`);
    // Below the large breakpoint the navigation is a drawer behind the menu button, the first button of the page header.
    const menu = page.locator('header button:visible').first();
    let opened = false;
    for (let waited = 0; waited < 20_000; waited += 100) {
      if ((await visible.count()) > 0) return void (await visible.first().click());
      if (!opened && (await menu.count()) > 0) {
        opened = true;
        await menu.click();
      }
      await page.waitForTimeout(100);
    }
    throw new Error(`the navigation link ${href} did not appear`);
  };
  if (name in SECTIONS && name !== 'Settings') return primary(SECTIONS[name]!);
  if (name in PLAN_TABS) {
    await primary('/plan/');
    await page.locator('[role=tab]').nth(PLAN_TABS[name]!).click();
    return;
  }
  const group = name === 'Settings' ? SETTINGS_GROUPS['Profile']! : SETTINGS_GROUPS[name];
  if (group !== undefined) {
    await primary('/settings/');
    await page.locator(`main ul a[href="${group}"]`).click();
    return;
  }
  throw new Error(`unknown screen ${name}`);
}

/**
 * Chooses the Fold every screen shows, through the switcher in the sidebar (offered once there is more than one Fold). The Fold may still be on
 * its way from the service or from a restore: the shell reads the list again when the person moves between screens, so the page moves between
 * two screens until the switcher appears and then returns to `screen`, the one the caller wants to be on.
 */
export async function chooseFold(page: Page, name: string, screen?: string): Promise<void> {
  // Both the navigation and the header of a narrow window show it, with the same text: the first one will do.
  const current = page.getByTestId('current-fold').first();
  if ((await current.textContent())?.trim() === name) return;
  const switcher = page.getByRole('button', { name: /^Switch Fold/ });
  // A narrow window keeps the navigation, the switcher with it, in a drawer behind the first button of the header (the large layout shows the links).
  const narrow = async () => (await page.locator('nav a[href="/overview/"]:visible').count()) === 0;
  const menu = page.locator('header button:visible').first();
  let moved = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await switcher.count()) > 0) break;
    if ((await narrow()) && (await menu.count()) > 0) {
      await menu.click();
      await page.waitForTimeout(300);
      const found = (await switcher.count()) > 0;
      await page.keyboard.press('Escape'); // the drawer is opened again below, for the click
      if (found) break;
    }
    await go(page, attempt % 2 === 0 ? 'Overview' : 'Accounts');
    moved = true;
    await page.waitForTimeout(1_000);
  }
  // In the drawer the switcher is taken out of the page when the drawer re-renders, so the whole step is repeated, with the menu opened again.
  await expect(async () => {
    if ((await switcher.count()) === 0 && (await narrow()) && (await menu.count()) > 0) await menu.click();
    await page.waitForFunction(() => document.querySelector('[data-enter],[data-leave],[data-closed]') === null, undefined, { timeout: 3_000 });
    await switcher.first().click({ timeout: 4_000 });
    await page.getByRole('menuitem', { name }).click({ timeout: 4_000 });
  }).toPass({ timeout: 30_000 });
  // Attached, not visible: a narrow window shows the name only inside the closed drawer.
  await page.getByTestId('current-fold').filter({ hasText: name }).first().waitFor({ state: 'attached' });
  if (moved && screen !== undefined) await go(page, screen);
}

/** Expands "More details" in the add sheet when it is collapsed (note, payee, tags, place and the other optional fields live there). */
export async function moreDetails(sheet: import('@playwright/test').Locator): Promise<void> {
  const toggle = sheet.getByRole('button', { name: /^More (details|options)/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

/** Cancels the add sheet; when it holds unsaved input the sheet asks first, and the person chooses to discard. */
export async function cancelAdd(page: Page, sheet: import('@playwright/test').Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  const discard = page.getByRole('button', { name: 'Discard', exact: true });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await page.getByRole('dialog').first().waitFor({ state: 'detached' }).catch(() => undefined);
}

/** Deletes a transaction from its row menu and confirms; `confirm` is false to stop at the confirmation. */
export async function openRowAction(page: Page, title: string, action: 'Edit' | 'Pin' | 'Unpin' | 'Delete'): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${title}` }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

/** Shows or hides the Recently deleted view of the transaction list (in the list's options menu). */
export async function toggleRecentlyDeleted(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'List options' }).click();
  await page.getByRole('menuitem', { name: /Recently deleted|Back to the list/ }).click();
}

/** The button that opens a transaction for editing: the title of its row (the row's other button is the actions menu). */
export function editRow(page: Page, title: string) {
  return page.getByTestId('tx-row').filter({ hasText: title }).getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first();
}

/** Opens an account's actions menu and chooses an entry (Add transaction, Adjust balance, Edit, Archive, Restore, Delete, ...). */
export async function accountAction(page: Page, account: string, action: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${account}` }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

const PASSWORD_FOR_SETUP = 'correct horse battery staple';

/** Signs up a fresh account on the page and lands on the Overview with the default Fold. Uses field types, not labels, so it works in every language. */
export async function signUpAndEnter(page: Page, email = 'alice@example.com'): Promise<void> {
  await page.goto('/sign-up/');
  await page.locator('input[type=email]').fill(email);
  const passwords = page.locator('input[type=password]');
  await passwords.nth(0).fill(PASSWORD_FOR_SETUP);
  await passwords.nth(1).fill(PASSWORD_FOR_SETUP);
  await page.locator('form [role=checkbox]').first().uncheck(); // keep-everything-on-this-device, in any language
  await page.locator('input[type=url]').fill('https://relay.example.com');
  await page.locator('form button[type=submit]').click();
  await page.getByTestId('secret-key').waitFor({ timeout: 60_000 });
  await page.locator('[role=checkbox]').first().check();
  await page.locator('main button:not([disabled])').last().click();
  // The first Fold is named in the language of the sign-up page (spec 004, FR-015), so any Fold will do.
  await page.getByTestId('current-fold').first().waitFor({ state: 'attached' });
}

/** Creates an account through the Accounts screen. */
export async function createAccount(page: Page, name: string, opening: string): Promise<void> {
  await go(page, 'Accounts');
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel(/^Opening balance/).fill(opening);
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('link', { name, exact: true }).waitFor();
}

/**
 * Unlocks the app after a reload. The page may show another screen for a moment while the vault state loads (the sign-up form also has a
 * "Password" field), so it waits for the Unlock screen before it types.
 */
export async function unlock(page: Page, password: string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

/**
 * Opens the Add transaction sheet. A click that lands before the screen is ready is swallowed (seen on Firefox), so the click is repeated until
 * the sheet is open instead of waiting out the test timeout for a dialog that will never come.
 */
export async function openAddTransaction(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if ((await dialog.count()) === 0) await page.getByRole('button', { name: 'Add transaction', exact: true }).click({ timeout: 5_000 });
    await expect(dialog).toHaveCount(1, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * Locks the app. In a narrow window (the Windows runners' small display) the button is inside the menu drawer, behind the first button of the
 * page header; in a wide one it is in the sidebar.
 */
export async function lock(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Lock', exact: true });
  if ((await button.count()) === 0) await page.locator('header button:visible').first().click();
  await button.first().click();
}
