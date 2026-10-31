import type { ElectronApplication, Page } from '@playwright/test';
import { go, lock, moreDetails } from '../../../e2e/fixtures/nav.js';
import { choose } from '../../../e2e/fixtures/select.js';
import { expect, signUp, test, unlock } from './fixtures';

// Spec 006, user story 5: the count of waiting entries, reminders on any screen and in the background, the tray, dock menu and jump list, and
// nothing of any of it while locked. The shell's surfaces are read through the test hooks; notifications are recorded in the page, not shown.

const pad = (n: number) => String(n).padStart(2, '0');
const daysFromToday = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

type Hooks = { badge(): number; presence(): { tray: string[]; dock: string[]; jumpList: string[] } };
const hook = <K extends keyof Hooks>(app: ElectronApplication, name: K): Promise<ReturnType<Hooks[K]>> =>
  app.evaluate((_electron, key) => (globalThis as unknown as { __cashfoldTest: Record<string, () => unknown> }).__cashfoldTest[key]!(), name) as Promise<ReturnType<Hooks[K]>>;
const badge = (app: ElectronApplication) => hook(app, 'badge');
const presence = (app: ElectronApplication) => hook(app, 'presence');

/** Records the notifications the page asks for, and lets the test say whether permission is given. The page is not reloaded, so the session stays. */
async function recordNotifications(page: Page, permission: 'default' | 'granted'): Promise<void> {
  await page.evaluate((initial) => {
    const shown: Array<{ title: string }> = [];
    Object.assign(window, { __shown: shown, __permission: initial });
    class FakeNotification {
      static get permission() {
        return (window as unknown as { __permission: string }).__permission;
      }
      static requestPermission = async () => FakeNotification.permission;
      constructor(title: string) {
        shown.push({ title });
      }
      close() {}
    }
    Object.assign(window, { Notification: FakeNotification });
  }, permission);
}
const shown = (page: Page) => page.evaluate(() => (window as unknown as { __shown?: Array<{ title: string }> }).__shown?.map((n) => n.title) ?? []);
const allow = (page: Page) => page.evaluate(() => Object.assign(window, { __permission: 'granted' }));

/** An account that was opened long ago, so a schedule that fell due yesterday can post into it (a new account opens today). */
async function createAccount(page: Page, name: string, opening: string): Promise<void> {
  await go(page, 'Accounts');
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel(/^Opening balance/).fill(opening);
  await moreDetails(dialog);
  await dialog.getByLabel('Opening date').fill('2020-01-01');
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('link', { name, exact: true }).waitFor();
}

async function addSchedule(page: Page, s: { name: string; first: string; confirm?: boolean; reminder?: string }): Promise<void> {
  await go(page, 'Schedules');
  await page.getByRole('button', { name: 'Add schedule', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(s.name);
  await dialog.getByLabel('Amount (USD)').fill('30.00');
  await dialog.getByLabel('First on').fill(s.first);
  await moreDetails(dialog);
  await dialog.getByLabel('Last on (optional)').fill(s.first);
  if (s.confirm) await dialog.getByLabel('Ask me to confirm each one before it counts').check();
  if (s.reminder) await choose(dialog.getByLabel('Reminder', { exact: true }), s.reminder);
  await dialog.getByRole('button', { name: 'Create schedule' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('the badge equals the number of waiting entries, and is 0 after a lock event', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await createAccount(page, 'Everyday', '1000.00');
  expect(await badge(app)).toBe(0);
  await addSchedule(page, { name: 'Gym', first: daysFromToday(-1), confirm: true });
  await addSchedule(page, { name: 'Rent', first: daysFromToday(-2), confirm: true });
  await expect.poll(() => badge(app)).toBe(2);
  await page.getByRole('button', { name: 'Confirm Gym' }).click();
  await expect.poll(() => badge(app)).toBe(1);
  // The computer locks: the shell clears the count at once, before the page has answered.
  await app.evaluate(() => (globalThis as unknown as { __cashfoldTest: { emitPower(e: string): void } }).__cashfoldTest.emitPower('lock-screen'));
  await expect.poll(() => badge(app)).toBe(0);
});

test('nothing is shown while locked: no count, no Fold name in any menu, no notification', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await createAccount(page, 'Everyday', '1000.00');
  await addSchedule(page, { name: 'Gym', first: daysFromToday(-1), confirm: true });
  await recordNotifications(page, 'granted');
  await expect.poll(() => badge(app)).toBe(1);
  expect(JSON.stringify(await presence(app))).toContain('Personal'); // the Fold's name is in the menus while unlocked
  await lock(page);
  await expect.poll(() => badge(app)).toBe(0);
  expect(JSON.stringify(await presence(app))).not.toContain('Personal');
  await page.waitForTimeout(500);
  expect(await shown(page)).toEqual([]);
  // After the unlock the count and the Fold come back.
  await unlock(page);
  await expect.poll(() => badge(app)).toBe(1);
});

test('the tray, dock menu and jump list offer the same few actions and no amount', async ({ session }) => {
  const { app } = await session.launch();
  const models = await presence(app);
  expect(models.tray).toEqual(['Show Cashfold', 'Add transaction', 'Lock', 'Quit']);
  if (process.platform === 'darwin') expect(models.dock).toEqual(['Add transaction', 'Lock']);
  if (process.platform === 'win32') expect(models.jumpList).toEqual(['Add transaction', 'Lock']);
});

test('a hidden window still shows a due reminder, once', async ({ session }) => {
  test.setTimeout(180_000);
  const { app, page } = await session.launch();
  await signUp(page);
  await createAccount(page, 'Everyday', '1000.00');
  await recordNotifications(page, 'default'); // not allowed yet: the due reminder waits
  await addSchedule(page, { name: 'Rent', first: daysFromToday(1), reminder: '1 day before' });
  expect(await shown(page)).toEqual([]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide());
  await allow(page);
  // The window is hidden: its timer must still run, so the reminder comes within the next check (a minute).
  // By default a notification names nothing (spec 016); the schedule's name is shown only when details are switched on in Settings.
  await expect.poll(() => shown(page), { timeout: 90_000 }).toEqual(['Cashfold has a reminder']);
  await page.waitForTimeout(1_000);
  expect(await shown(page)).toEqual(['Cashfold has a reminder']);
});

test('a launch with --action=add-transaction shows the window and opens the add sheet', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide());
  await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance', {}, ['cashfold', '--action=add-transaction'], ''));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true);
  await expect.poll(() => page.evaluate(() => location.search)).toContain('new=expense');
});

test('an action outside the closed set on a second launch only shows the window', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide());
  await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance', {}, ['cashfold', '--action=delete-everything'], ''));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true);
  expect(await page.evaluate(() => location.search)).not.toContain('new=');
});

test.describe('closing the window', () => {
  test('quits by default on Windows and Linux; with "keep running" it hides, the session and timers go on, and Quit really quits', async ({ session }) => {
    const { app, page } = await session.launch();
    await signUp(page);
    const capabilities = await page.evaluate(() => (window as unknown as { cashfoldDesktop: { settings: { get(): Promise<{ settings: { closeBehavior: string }; capabilities: { statusItem: boolean } }> } } }).cashfoldDesktop.settings.get());
    expect(capabilities.settings.closeBehavior).toBe(process.platform === 'darwin' ? 'background' : 'quit');
    test.skip(!capabilities.capabilities.statusItem, 'this desktop shows no tray icon, so "keep running" is not offered');
    await page.evaluate(() => (window as unknown as { cashfoldDesktop: { settings: { set(c: object): Promise<unknown> } } }).cashfoldDesktop.settings.set({ closeBehavior: 'background' }));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    // Hidden, not destroyed: the page is alive and still unlocked.
    expect(await app.evaluate(({ BrowserWindow }) => [BrowserWindow.getAllWindows().length, BrowserWindow.getAllWindows()[0]!.isVisible()])).toEqual([1, false]);
    expect(await page.evaluate(() => 1 + 1)).toBe(2);
    await expect(page.getByTestId('current-fold')).toHaveText('Personal');
    const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await exited;
  });

  test('"keep running" is refused where there is no status item', async ({ session }) => {
    const { page } = await session.launch();
    await signUp(page);
    const result = await page.evaluate(() =>
      (window as unknown as { cashfoldDesktop: { settings: { get(): Promise<{ capabilities: { statusItem: boolean } }>; set(c: object): Promise<{ settings: { closeBehavior: string } }> } } }).cashfoldDesktop.settings.get().then(async (state) => ({
        statusItem: state.capabilities.statusItem,
        after: (await (window as unknown as { cashfoldDesktop: { settings: { set(c: object): Promise<{ settings: { closeBehavior: string } }> } } }).cashfoldDesktop.settings.set({ closeBehavior: 'background' })).settings.closeBehavior,
      })),
    );
    expect(result.after).toBe(result.statusItem ? 'background' : 'quit');
  });
});
