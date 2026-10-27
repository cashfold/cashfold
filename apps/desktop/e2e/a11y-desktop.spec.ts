import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { go } from '../../../e2e/fixtures/nav.js';
import { expect, signUp, test } from './fixtures';

// Spec 006, polish: the interface that exists only in the desktop app (Settings → Desktop, the drop messages, the frame bar) passes the same WCAG 2.2 AA
// checks as the rest, in both themes, and the bar is hidden from assistive technology.

async function expectNoViolations(page: Page): Promise<void> {
  // Over a translucent material (vibrancy, Mica) the real background is the system's, which axe cannot see: it would compare against plain white. The
  // opaque look is what is measured here; the translucent one is looked at by hand (verification V5).
  await page.evaluate(() => (document.documentElement.dataset['translucent'] = 'false'));
  await page.waitForFunction(() => document.querySelector('[data-enter],[data-leave],[data-closed]') === null, undefined, { timeout: 5_000 }).catch(() => undefined);
  const results = await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  test(`Settings → Desktop has no accessibility violations (${theme} theme)`, async ({ session }) => {
    const { page } = await session.launch();
    await signUp(page);
    await go(page, 'Desktop');
    await expect(page.getByTestId('desktop-start-at-login')).toBeVisible();
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    await expectNoViolations(page);
  });

  test(`a drop message has no accessibility violations (${theme} theme)`, async ({ session }) => {
    const { page } = await session.launch();
    await signUp(page);
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    // The part of the page that takes drops loads a moment after the unlocked screen, so the drop is repeated until it is answered.
    await expect(async () => {
      await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['x'], 'photo.png', { type: 'image/png' }));
        document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      });
      await expect(page.getByText('Only a CSV file can be dropped here.')).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expectNoViolations(page);
  });
}

test('the frame bar is hidden from assistive technology, and takes no focus', async ({ session }) => {
  test.skip(process.platform === 'linux', 'Linux keeps the system title bar');
  const { page } = await session.launch();
  await page.goto('app://cashfold/sign-in/');
  const bar = page.getByTestId('frame-bar');
  await expect(bar).toHaveAttribute('aria-hidden', 'true');
  expect(await bar.evaluate((el) => el.querySelectorAll('a, button, input, select, textarea, [tabindex]').length)).toBe(0);
});

test('the keyboard order starts with the skip link, below the bar', async ({ session }) => {
  const { page } = await session.launch();
  await page.goto('app://cashfold/sign-in/');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Skip to main content');
});
