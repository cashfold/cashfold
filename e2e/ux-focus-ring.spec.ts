import { expect, test } from './fixtures/index.js';
import { createAccount, signUpAndEnter } from './fixtures/nav.js';

// The focus ring is drawn 3px wide and 2px off its field. A dialog body scrolls, and a scroll container clips what is drawn outside its edge, so a field
// at the edge of the body lost the outer part of its ring. The ring must fit inside the scroll container.

const RING = 3 + 2;

test.describe('@ux focus ring in dialogs', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });

  test('the ring of the focused field is not cut off by the add sheet', async ({ page }) => {
    test.setTimeout(240_000);
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '10.00');
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    const sheet = page.getByRole('dialog');
    const amount = sheet.getByLabel(/^Amount/);
    await expect(amount).toBeFocused();
    const room = await amount.evaluate((field) => {
      let scroller: HTMLElement | null = field.parentElement;
      while (scroller !== null && !/(auto|scroll|hidden)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      if (scroller === null) return { left: Infinity, right: Infinity, top: Infinity };
      const f = field.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      return { left: f.left - s.left, right: s.right - f.right, top: f.top - s.top };
    });
    expect(room.left).toBeGreaterThanOrEqual(RING);
    expect(room.right).toBeGreaterThanOrEqual(RING);
    expect(room.top).toBeGreaterThanOrEqual(RING);
  });
});
