import { expect, test } from './fixtures/index.js';
import { go, signUpAndEnter } from './fixtures/nav.js';

// Theme (FR-041, FR-045; R-UX-05): the attribute is set before first paint, the choice applies at once and persists, and the interface keeps its
// cues under forced colours and reduced motion. A blocked localStorage falls back to the system setting with no error.

test.describe('@ux theme', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  test('first paint already has the system theme, with no flash of the other one', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => ((window as unknown as { __theme?: string }).__theme = document.documentElement.dataset['theme']));
    });
    await page.goto('/sign-in/');
    expect(await page.evaluate(() => (window as unknown as { __theme?: string }).__theme)).toBe('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('Light, Dark and System apply at once and are remembered across a reload', async ({ page, expectNoA11yViolations }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: 'light' });
    await signUpAndEnter(page);
    await go(page, 'Appearance');
    await page.getByRole('radio', { name: 'Dark' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectNoA11yViolations();
    await page.getByRole('radio', { name: 'System' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('radio', { name: 'Dark' }).check();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cashfold.ui') ?? '{}').theme)).toBe('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('keeps working when localStorage is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/sign-in/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('forced colours and reduced motion keep the page usable', async ({ page, expectNoA11yViolations }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.goto('/sign-up/');
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe('none');
    await expectNoA11yViolations();
  });
});
