import type { ElectronApplication, Page } from '@playwright/test';
import { expect, signUp, test } from './fixtures';

// Spec 006, user story 3 (as amended by spec 007: shortcuts only, no menu): each shortcut does its action, and a locked app does nothing with a data one.

const mod = process.platform === 'darwin' ? 'meta' : 'control';

/**
 * A key press the way the system delivers it to the window. Playwright's own keyboard goes straight to the page and never passes the shell's
 * key handling (`before-input-event`), which is what these shortcuts are, so the press is sent from the main process.
 */
async function press(app: ElectronApplication, key: string, ...modifiers: string[]): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { keyCode, mods }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents;
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods as never });
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods as never });
    },
    { keyCode: key, mods: modifiers },
  );
}
/** The page loads the part that carries out shortcuts a moment after the unlocked screen appears (it is desktop-only, loaded on demand). */
const settled = (page: Page) => page.waitForTimeout(1_000);
const path = (page: Page) => page.evaluate(() => location.pathname);

test('the shortcuts take you where they say, and open the add sheet', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await settled(page);

  await press(app, '2', mod);
  await expect.poll(() => path(page)).toBe('/transactions/');
  await press(app, '3', mod);
  await expect.poll(() => path(page)).toBe('/accounts/');
  await press(app, '4', mod);
  await expect.poll(() => path(page)).toBe('/plan/');
  await press(app, '1', mod);
  await expect.poll(() => path(page)).toBe('/overview/');
  await press(app, ',', mod);
  await expect.poll(() => path(page)).toBe('/settings/');
  await press(app, '5', mod);
  await expect.poll(() => path(page)).toBe('/settings/');

  await press(app, 'n', mod);
  await expect.poll(() => page.evaluate(() => location.search)).toContain('new=expense');
  await expect(page.getByRole('dialog')).toHaveCount(1); // the add sheet
});

test('search puts the cursor in the Transactions search field, from any screen', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await settled(page);
  await press(app, 'f', mod);
  await expect.poll(() => path(page)).toBe('/transactions/');
  await expect(page.getByRole('searchbox')).toBeFocused();
});

test('import and export land on Settings → Data with the panel focused', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await settled(page);
  await press(app, 'i', mod, 'shift');
  await expect.poll(() => path(page)).toBe('/settings/data/');
  await press(app, 'e', mod, 'shift');
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('section')?.getAttribute('aria-labelledby'))).toBe('export-heading');
});

test('lock locks, and a data shortcut then does nothing', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await settled(page);
  await press(app, 'l', mod);
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
  await press(app, 'n', mod);
  await press(app, '2', mod);
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await path(page)).not.toBe('/transactions/');
});
