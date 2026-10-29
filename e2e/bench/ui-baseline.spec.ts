import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/index.js';

// Baseline of the interface before the redesign (SC-002, SC-003, SC-005; specs/002-ux-redesign-catalyst/quickstart.md §0). It counts what a
// person sees on first load: visible interactive elements per screen, the fields of the add form and the primary navigation entries. The result
// is written to specs/002-ux-redesign-catalyst/baseline.json and committed BEFORE any interface change; T115 repeats the measurement on the
// finished interface and compares. Opt in with BASELINE=1 so an ordinary e2e run does not rewrite the file.

const PASSWORD = 'correct horse battery staple';
const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role=button], [role=tab], [role=menuitem]';
const SCREENS = ['Dashboard', 'Transactions', 'Accounts', 'Budgets', 'Goals', 'Schedules', 'Settings'];
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '1280x800', width: 1280, height: 800 },
];

test.describe('@bench interface baseline', () => {
  test.skip(process.env['BASELINE'] !== '1', 'set BASELINE=1 to record the baseline');
  test.skip(({ browserName }) => browserName !== 'chromium', 'one browser is enough to count controls');

  const visibleControls = (page: Page, root = 'body') =>
    page.evaluate(
      ({ selector, scope }) =>
        [...(document.querySelector(scope) ?? document.body).querySelectorAll<HTMLElement>(selector)].filter((el) => {
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !(el instanceof HTMLInputElement && el.type === 'hidden');
        }).length,
      { selector: INTERACTIVE, scope: root },
    );

  test('counts controls, add-form fields and navigation entries', async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto('/sign-up/');
    await page.getByLabel('Email address', { exact: true }).fill('alice@example.com');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByLabel('Keep everything on this device for now').uncheck();
    await page.getByLabel('Service address').fill('https://relay.example.com');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('fold-name')).toHaveText('Personal');

    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Accounts', exact: true }).click();
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    const account = page.getByRole('dialog');
    await account.getByLabel('Name', { exact: true }).fill('Everyday');
    await account.getByLabel('Opening balance (USD)').fill('100.00');
    await account.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const result: Record<string, unknown> = { recordedAt: new Date().toISOString().slice(0, 10), interface: 'before the redesign', viewports: {} };
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const screens: Record<string, number> = {};
      for (const screen of SCREENS) {
        // A full page load would lock the app, so screens are reached through the navigation only.
        await nav.getByRole('link', { name: screen, exact: true }).click();
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        screens[screen] = await visibleControls(page);
      }
      await nav.getByRole('link', { name: 'Transactions', exact: true }).click();
      await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const addFormControls = await visibleControls(page, '[role=dialog]');
      const addFormFields = await dialog.evaluate(
        (d) => [...d.querySelectorAll<HTMLElement>('input, select, textarea')].filter((el) => el.getBoundingClientRect().width > 0 && !(el instanceof HTMLInputElement && el.type === 'hidden')).length,
      );
      await page.keyboard.press('Escape');
      const navEntries = await nav.getByRole('link').evaluateAll((links) => links.filter((l) => l.getBoundingClientRect().width > 0).length).catch(() => 0);
      (result['viewports'] as Record<string, unknown>)[viewport.name] = { screens, addFormControls, addFormFields, primaryNavigationEntries: navEntries };
    }
    writeFileSync(new URL('../../specs/002-ux-redesign-catalyst/baseline.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
  });
});
