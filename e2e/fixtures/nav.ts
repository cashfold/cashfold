import type { Page } from '@playwright/test';

// Navigation helper for the specs. It takes the names of the screens as people knew them before the redesign and follows the new structure
// in the app (no page reload, so the app stays unlocked): five sidebar entries, Plan tabs and the Settings groups.

const PLAN_TABS = new Set(['Budgets', 'Goals', 'Schedules']);
const SETTINGS_GROUPS: Record<string, string> = {
  Categories: 'Categories',
  Folds: 'Folds and sharing',
  Data: 'Data and storage',
  Devices: 'Sync and devices',
  Profile: 'Profile and security',
  Appearance: 'Appearance',
  Advanced: 'Advanced',
};

export async function go(page: Page, name: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Main' });
  const primary = (label: string) => nav.getByRole('link', { name: label, exact: true }).click();
  if (name === 'Dashboard' || name === 'Overview') return primary('Overview');
  if (PLAN_TABS.has(name)) {
    await primary('Plan');
    await page.getByRole('tab', { name }).click();
    return;
  }
  const group = SETTINGS_GROUPS[name];
  if (group !== undefined) {
    await primary('Settings');
    await page.getByRole('main').getByRole('link', { name: group }).click();
    return;
  }
  return primary(name);
}

/** Chooses the Fold every screen shows, through the switcher in the sidebar (offered once there is more than one Fold). */
export async function chooseFold(page: Page, name: string): Promise<void> {
  const current = page.getByTestId('current-fold');
  if ((await current.textContent())?.trim() === name) return;
  await page.getByRole('button', { name: /^Switch Fold/ }).click();
  await page.getByRole('menuitem', { name }).click();
  await page.getByTestId('current-fold').filter({ hasText: name }).waitFor();
}
