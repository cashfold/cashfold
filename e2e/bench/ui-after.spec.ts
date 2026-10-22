import { readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/index.js';
import { createAccount, go, signUpAndEnter } from '../fixtures/nav.js';

// T115 (SC-002, SC-003, SC-005): the measurement of ui-baseline.spec.ts repeated on the finished interface and compared with the one recorded
// before the redesign (specs/002-ux-redesign-catalyst/baseline.json). Writes specs/002-ux-redesign-catalyst/after.json. Opt in with AFTER=1.

const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role=button], [role=tab], [role=menuitem]';
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '1280x800', width: 1280, height: 800 },
] as const;
// Old screen name in the baseline -> where it lives now.
const SCREENS = { Dashboard: 'Overview', Transactions: 'Transactions', Settings: 'Settings' } as const;
const ROUTES: Record<string, RegExp> = { Overview: /\/overview\/$/, Transactions: /\/transactions\/$/, Settings: /\/settings\/$/ };
const REQUIRED_REDUCTION = 0.4;
const MAX_DEFAULT_ADD_FIELDS = 5;

const baseline = JSON.parse(readFileSync(new URL('../../specs/002-ux-redesign-catalyst/baseline.json', import.meta.url), 'utf8')) as {
  viewports: Record<string, { screens: Record<string, number>; addFormControls: number }>;
};

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

test.describe('@bench interface after the redesign', () => {
  test.skip(process.env['AFTER'] !== '1', 'set AFTER=1 to measure the finished interface');
  test.skip(({ browserName }) => browserName !== 'chromium', 'one browser is enough to count controls');

  test('shows at least 40 % fewer controls, five navigation entries and at most five default add fields', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '100.00');

    const result: Record<string, unknown> = { recordedAt: new Date().toISOString().slice(0, 10), interface: 'after the redesign', viewports: {} };
    const misses: string[] = [];
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const before = baseline.viewports[viewport.name]!;
      const screens: Record<string, number> = {};
      for (const [old, now] of Object.entries(SCREENS)) {
        await go(page, now);
        await page.waitForURL(ROUTES[now]!);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);
        screens[now] = await visibleControls(page);
        if (process.env['DUMP']) console.log(viewport.name, now, JSON.stringify(await page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; }).map((el) => `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 25)}`), INTERACTIVE)));
        const allowed = Math.floor(before.screens[old]! * (1 - REQUIRED_REDUCTION));
        if (screens[now]! > allowed) misses.push(`${now} at ${viewport.name}: ${screens[now]} controls, at most ${allowed} (was ${before.screens[old]})`);
      }
      await go(page, 'Transactions');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.locator('button[aria-label="Add"]:visible, button:visible:text-is("Add")').first().click();
      const sheet = page.getByRole('dialog', { name: 'Add transaction' });
      await expect(sheet.getByLabel(/^Amount/)).toBeVisible();
      const addFormControls = await visibleControls(page, '[role=dialog]');
      const addFormFields = await sheet.evaluate((d) => [...d.querySelectorAll<HTMLElement>('input, select, textarea')].filter((el) => el.getBoundingClientRect().width > 0 && !(el instanceof HTMLInputElement && el.type === 'hidden')).length);
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      const allowedAdd = Math.floor(before.addFormControls * (1 - REQUIRED_REDUCTION));
      if (addFormControls > allowedAdd) misses.push(`add form at ${viewport.name}: ${addFormControls} controls, at most ${allowedAdd} (was ${before.addFormControls})`);
      if (addFormFields > MAX_DEFAULT_ADD_FIELDS) misses.push(`add form at ${viewport.name}: ${addFormFields} default fields, at most ${MAX_DEFAULT_ADD_FIELDS}`);

      // The navigation: below the large breakpoint it is a drawer behind the menu button.
      const menu = page.locator('header button:visible').first();
      if (viewport.width < 1024) await menu.click();
      const entries = await page.locator('nav a[href]:visible').evaluateAll((links) => links.filter((l) => ['/overview/', '/transactions/', '/accounts/', '/plan/', '/settings/'].includes(l.getAttribute('href') ?? '')).length);
      if (viewport.width < 1024) await page.keyboard.press('Escape');
      if (entries !== 5) misses.push(`navigation at ${viewport.name}: ${entries} primary entries, expected 5`);
      (result['viewports'] as Record<string, unknown>)[viewport.name] = { screens, addFormControls, addFormFields, primaryNavigationEntries: entries };
    }
    writeFileSync(new URL('../../specs/002-ux-redesign-catalyst/after.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
    expect(misses, misses.join('\n')).toEqual([]);
  });
});
