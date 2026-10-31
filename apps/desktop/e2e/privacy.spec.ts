import type { ElectronApplication, Page } from '@playwright/test';
import { createAccount, go } from '../../../e2e/fixtures/nav.js';
import { expect, signUp, test } from './fixtures';

// Spec 016: Privacy mode in the desktop app. The shell owns the shortcut (its table sends the page a `privacy` action, ignored while locked), so the key is
// pressed the way the system delivers it to the window. This runs on the host system only (run it on each system).

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

const indicator = (page: Page) => page.getByTestId('privacy-indicator');
const balance = (page: Page) => page.getByTestId('account-balance').first();

test('Command/Ctrl+Shift+M turns Privacy mode on and off, shows the state, and does nothing while locked', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await page.waitForTimeout(1_000);
  await createAccount(page, 'Everyday', '1234.56');
  await go(page, 'Accounts');
  await expect(balance(page)).toContainText('1,234.56 USD');
  await expect(indicator(page)).toHaveCount(0);

  await press(app, 'm', primary, 'shift');
  await expect(balance(page).locator('[data-privacy-mask]')).toHaveCount(1);
  await expect(balance(page)).toContainText('USD');
  await expect(balance(page)).not.toContainText('1,234');
  await expect(indicator(page)).toContainText('Privacy mode on');

  await press(app, 'm', primary, 'shift');
  await expect(balance(page)).toContainText('1,234.56 USD');
  await expect(indicator(page)).toHaveCount(0);

  // Plain Mod+M is still minimise, and does not touch the mode.
  await press(app, 'm', primary, 'shift');
  await expect(indicator(page)).toBeVisible();

  // Locked, the key does nothing: the mode is as it was when the app is unlocked again.
  await press(app, 'l', primary);
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
  await press(app, 'm', primary, 'shift');
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
});

test('a revealed amount is masked again when the window is left', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await page.waitForTimeout(1_000);
  await createAccount(page, 'Everyday', '1234.56');
  await go(page, 'Accounts');
  await press(app, 'm', primary, 'shift');
  await balance(page).locator('[role="button"]').click();
  await expect(balance(page)).toContainText('1,234.56 USD');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(balance(page).locator('[data-privacy-mask]')).toHaveCount(1);
});
