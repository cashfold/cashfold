import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go, signUpAndEnter } from './fixtures/nav.js';

// Hard-coded English (spec 004, FR-001, SC-001). The catalogue check can only see messages that exist; a word typed straight into a component
// never reaches a translator. In the test-only pseudo-locale (en-XA) every message comes out accented and longer, so any plain English word still
// on a screen did not come from the catalogue. This walks the screens and the sheets, and lists such words.

/** Words that are the person's own data or a code, not text of the app. */
const OWN_DATA = new Set(['alice', 'example', 'com', 'relay', 'https', 'http', 'www', 'usd', 'eur']);

async function untranslated(page: Page): Promise<string[]> {
  return page.evaluate((ownData) => {
    const found = new Set<string>();
    const look = (text: string, where: string) => {
      for (const word of text.match(/[A-Za-z]{3,}/g) ?? []) {
        if (/^[A-Z]{3,}$/.test(word)) continue; // currency codes and acronyms such as CSV
        if (ownData.includes(word.toLowerCase())) continue;
        found.add(`${word} (${where})`);
      }
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const element = node.parentElement;
      if (element === null || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(element.tagName)) continue;
      if (element.closest('[data-own-data],[data-testid="secret-key"]')) continue;
      // The names of the languages are written in their own language on purpose ("Polski"), so they can be found from a page that cannot be read.
      if (element.tagName === 'OPTION' && element.hasAttribute('lang')) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      look(node.textContent ?? '', element.tagName.toLowerCase());
    }
    for (const element of document.querySelectorAll('[aria-label],[placeholder],[title],[alt]')) {
      for (const attribute of ['aria-label', 'placeholder', 'title', 'alt']) {
        const value = element.getAttribute(attribute);
        if (value !== null) look(value, `${element.tagName.toLowerCase()}[${attribute}]`);
      }
    }
    return [...found].sort();
  }, [...OWN_DATA]);
}

test.describe('@pseudo-walk no text outside the catalogue', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
    test.skip(test.info().project.name !== 'pseudo', 'runs in the pseudo-locale project only');
  });

  test('every screen, the add sheet and a dialog', async ({ page }) => {
    test.setTimeout(240_000);
    const report: Record<string, string[]> = {};
    const visited: string[] = [];
    const check = async (name: string) => {
      visited.push(name);
      await page.waitForFunction(() => document.querySelector('[data-enter],[data-leave],[data-closed]') === null, undefined, { timeout: 3_000 }).catch(() => undefined);
      const words = await untranslated(page);
      if (words.length > 0) report[name] = words;
    };

    await page.goto('/sign-up/');
    await check('sign-up');
    await page.goto('/');
    await check('home before sign-in');

    await signUpAndEnter(page);
    for (const screen of ['Overview', 'Transactions', 'Accounts', 'Budgets', 'Goals', 'Schedules', 'Settings', 'Appearance', 'Categories', 'Folds', 'Data', 'Devices', 'Advanced'] as const) {
      await go(page, screen);
      await expect(page.locator('h1').first()).toBeVisible();
      // The Folds screen shows the person's invitation code once the worker has made it; wait, so the walk reads it every time and not only when CI is slow (it is the person's own data, marked data-own-data).
      if (screen === 'Folds') await expect(page.getByTestId('my-code')).toBeVisible();
      await check(screen);
    }

    // A screen the walk reads is really in the pseudo-locale: its heading is accented (otherwise the check above would find nothing to object to).
    expect(await page.locator('h1').first().innerText()).toMatch(/[À-ž]/);

    // A dialog: add an account.
    await go(page, 'Accounts');
    await page.locator('main h1').locator('xpath=..').getByRole('button').first().click();
    await page.getByRole('dialog').waitFor({ state: 'attached', timeout: 10_000 });
    await check('add-account dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10_000 });

    // The add sheet, from the sidebar (it opens whatever the screen), with its optional fields.
    await go(page, 'Overview');
    await page.locator('nav button:not([aria-haspopup]):visible').first().click();
    await page.getByRole('dialog').waitFor({ state: 'attached', timeout: 10_000 });
    await check('add sheet');
    const more = page.getByRole('dialog').getByRole('button', { expanded: false }).first();
    if ((await more.count()) > 0) await more.click().catch(() => undefined);
    await check('add sheet, more details');
    await page.keyboard.press('Escape');

    expect(visited.length, 'screens walked').toBeGreaterThanOrEqual(17);
    expect(report, 'text that did not come from the catalogue:').toEqual({});
  });
});
