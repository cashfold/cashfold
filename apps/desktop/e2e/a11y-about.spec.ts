import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { go } from '../../../e2e/fixtures/nav.js';
import { expect, signUp, test } from './fixtures';

// Constitution Quality Gates: the About section (and the page that holds it) passes the same WCAG 2.2 AA checks as the rest of the interface,
// in the light and the dark theme, inside the desktop app.

async function expectNoViolations(page: Page): Promise<void> {
  // Over a translucent material (vibrancy, Mica) the real background is the system's, which axe cannot see: it would compare against plain white. The
  // opaque look is what is measured here (as in a11y-desktop.spec.ts).
  await page.evaluate(() => (document.documentElement.dataset['translucent'] = 'false'));
  await page.waitForFunction(() => document.querySelector('[data-enter],[data-leave],[data-closed]') === null, undefined, { timeout: 5_000 }).catch(() => undefined);
  // Legacy mode: axe runs in this page only. Its default opens a second page for cross-frame analysis, which Electron cannot do.
  const results = await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  test(`the About section has no accessibility violations (${theme} theme)`, async ({ session }) => {
    const { page } = await session.launch();
    await signUp(page);
    await go(page, 'Advanced');
    await expect(page.getByTestId('about-version')).toBeVisible();
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    await expectNoViolations(page);
  });
}
