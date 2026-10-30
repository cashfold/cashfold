import type { ElectronApplication, Page } from '@playwright/test';
import { expect, signUp, test } from './fixtures';

// Spec 015: the command palette in the desktop app. The shell owns the shortcut (its table sends the page a `palette` action, ignored while locked), so the
// key is pressed the way the system delivers it to the window. This runs on the host system only (run it on each system).

const mac = process.platform === 'darwin';
const primary = mac ? 'meta' : 'control';

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

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' });
const box = (page: Page) => dialog(page).getByRole('combobox');
const path = (page: Page) => page.evaluate(() => location.pathname);

test('Command/Ctrl+K opens the palette, finds a screen, closes with the shortcut, and is gone when the app locks', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await page.waitForTimeout(1_000);

  await press(app, 'k', primary);
  await expect(box(page)).toBeFocused();
  await expect(box(page)).toHaveAttribute('placeholder', mac ? /⌘K/ : /Ctrl\+K/);

  // A screen, by letters that are not next to each other.
  await page.keyboard.type('trns');
  await page.keyboard.press('Enter');
  await expect.poll(() => path(page)).toBe('/transactions/');
  await expect(dialog(page)).toHaveCount(0);

  // The shortcut again closes it.
  await press(app, 'k', primary);
  await expect(box(page)).toBeFocused();
  await press(app, 'k', primary);
  await expect(dialog(page)).toHaveCount(0);

  // Another shortcut closes the palette first, then runs (spec 008).
  await press(app, 'k', primary);
  await expect(box(page)).toBeFocused();
  await press(app, '3', primary);
  await expect.poll(() => path(page)).toBe('/accounts/');
  await expect(dialog(page)).toHaveCount(0);

  // Locking with the palette open takes it away; while locked the shortcut does nothing.
  await press(app, 'k', primary);
  await expect(box(page)).toBeFocused();
  await press(app, 'l', primary);
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await press(app, 'k', primary);
  await page.waitForTimeout(500);
  await expect(dialog(page)).toHaveCount(0);
});

test('the palette does not open over Help', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await page.waitForTimeout(1_000);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Help' })).toHaveCount(1);
  await press(app, 'k', primary);
  await page.waitForTimeout(500);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Help' })).toHaveCount(1);
});
