import { expect, test } from './fixtures/index.js';

// Application shell: landmarks, skip link, accessibility, and right-to-left layout (FR-094, FR-095).
// The `rtl` Playwright project runs every spec with an Arabic browser locale.

test('shell has landmarks, a working skip link and no axe violations', async ({ page, expectNoA11yViolations }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.locator('a[href="#main"]');
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  await expectNoA11yViolations();
});

test('every route renders a single level-one heading', async ({ page }) => {
  for (const route of ['/dashboard/', '/accounts/', '/transactions/', '/transfers/', '/categories/', '/folds/', '/settings/', '/sign-in/', '/sign-up/', '/add/']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 }), route).toHaveCount(1);
  }
});

test('language and direction follow the browser locale, and layout mirrors logically', async ({ page, browserName }, info) => {
  await page.goto('/');
  const rtl = info.project.name === 'rtl';
  await expect(page.locator('html')).toHaveAttribute('dir', rtl ? 'rtl' : 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', rtl ? 'ar' : 'en');
  // The brand link comes first in the DOM; it must sit at the inline start: left in LTR, right in RTL.
  const brand = await page.getByRole('link', { name: 'Cashfold' }).boundingBox();
  const viewport = page.viewportSize()!;
  expect(brand).not.toBeNull();
  const centre = brand!.x + brand!.width / 2;
  if (rtl) expect(centre).toBeGreaterThan(viewport.width / 2);
  else expect(centre).toBeLessThan(viewport.width / 2);
  expect(browserName).toBeTruthy();
});

test('leaves nothing in storage on a plain visit', async ({ page, leakScan }) => {
  const capture = leakScan.begin();
  await page.goto('/');
  await leakScan.expectNoLeaks({ strings: ['Alice Example'], amounts: ['12.50'] }, capture);
});
