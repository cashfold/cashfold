import AxeBuilder from '@axe-core/playwright';
import type { ElectronApplication, Page } from '@playwright/test';
import { HELP_SHORTCUTS, type HelpShortcut } from '../../../packages/platform/src/help-shortcuts';
import { expect, signUp, test } from './fixtures';

// Spec 008: the Help dialog lists the desktop shortcuts as this system writes them, every listed shortcut does what its name says, the list says only Lock
// works while locked, and a shortcut pressed with the dialog open closes it and then runs. The list is tested against the shell's table by
// src/main/help-shortcuts.test.ts; here the keys are really pressed. This runs on the host system only (spec 008, SC-002: run it on each system).

const mac = process.platform === 'darwin';
const primary = mac ? 'meta' : 'control';

/** A key press the way the system delivers it to the window (the shell's key handling does not see Playwright's own keyboard; see shortcuts.spec.ts). */
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

/** The press the list describes for this system. */
function pressOf(item: HelpShortcut): { key: string; modifiers: string[] } {
  const keys = item.keys[mac ? 'mac' : 'other'];
  const modifiers = keys.modifiers.map((m) => (m === 'primary' ? primary : m === 'ctrl' ? 'control' : m));
  const key = keys.key === '+' ? '=' : keys.key.length === 1 ? keys.key.toLowerCase() : keys.key;
  return { key, modifiers };
}
const pressItem = (app: ElectronApplication, id: string) => {
  const { key, modifiers } = pressOf(HELP_SHORTCUTS.find((s) => s.id === id)!);
  return press(app, key, ...modifiers);
};

const settled = (page: Page) => page.waitForTimeout(1_000);
const path = (page: Page) => page.evaluate(() => location.pathname);
const help = (page: Page) => page.getByRole('button', { name: 'Help', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Help' });
const open = async (page: Page) => {
  await help(page).click();
  await expect(dialog(page).getByRole('heading', { name: 'Help', level: 2 })).toBeVisible();
};
const winState = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]!;
  return { zoom: w.webContents.getZoomLevel(), fullscreen: w.isFullScreen(), minimized: w.isMinimized() };
});

/** What each app shortcut does, observed in the page. */
const EFFECT: Record<string, (page: Page) => Promise<void>> = {
  'new-transaction': (page) => expect.poll(() => page.evaluate(() => location.search)).toContain('new=expense'),
  settings: (page) => expect.poll(() => path(page)).toBe('/settings/'),
  search: async (page) => {
    await expect.poll(() => path(page)).toBe('/transactions/');
    await expect(page.getByRole('searchbox')).toBeFocused();
  },
  'go-overview': (page) => expect.poll(() => path(page)).toBe('/overview/'),
  'go-transactions': (page) => expect.poll(() => path(page)).toBe('/transactions/'),
  'go-accounts': (page) => expect.poll(() => path(page)).toBe('/accounts/'),
  'go-plan': (page) => expect.poll(() => path(page)).toBe('/plan/'),
  'go-settings': (page) => expect.poll(() => path(page)).toBe('/settings/'),
  import: (page) => expect.poll(() => path(page)).toBe('/settings/data/'),
  export: (page) => expect.poll(() => page.evaluate(() => document.activeElement?.closest('section')?.getAttribute('aria-labelledby'))).toBe('export-heading'),
};

test('Help lists the shortcuts the way this system writes them, with the locked note, and closes with Escape or Close', async ({ session }) => {
  const { page } = await session.launch();
  await signUp(page);
  await settled(page);
  await open(page);
  const d = dialog(page);
  await expect(d.getByText('Keyboard shortcuts')).toBeVisible();
  await expect(d.getByText('While the app is locked, only Lock works.')).toBeVisible();
  const text = (await d.innerText()).replace(/\s+/g, ' ');
  for (const [name, written] of mac
    ? [['New transaction', '⌘N'], ['Import', '⇧⌘I'], ['Full screen', '⌃⌘F']]
    : [['New transaction', 'Ctrl+N'], ['Import', 'Ctrl+Shift+I'], ['Full screen', 'F11']]) {
    expect(text, name).toContain(`${name} ${written}`);
  }
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await expect(help(page)).toBeFocused();
  await open(page);
  await d.getByRole('button', { name: 'Close' }).click();
  await expect(d).toHaveCount(0);
  await expect(help(page)).toBeFocused();
});

test('every listed app shortcut does what its name says', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await settled(page);
  for (const item of HELP_SHORTCUTS.filter((s) => s.group === 'app' && s.id !== 'lock')) {
    await pressItem(app, 'go-overview');
    await expect.poll(() => path(page), item.id).toBe('/overview/');
    await pressItem(app, item.id);
    await EFFECT[item.id]!(page);
    if (item.id === 'new-transaction') await page.keyboard.press('Escape');
  }
  await pressItem(app, 'lock');
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
});

test('while locked every listed shortcut except Lock does nothing', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await settled(page);
  await pressItem(app, 'lock');
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
  for (const item of HELP_SHORTCUTS.filter((s) => s.group === 'app' && s.id !== 'lock')) await pressItem(app, item.id);
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the standard shortcuts in the list work: zoom, full screen, minimise', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await settled(page);
  const start = (await winState(app)).zoom;
  await pressItem(app, 'zoom-in');
  await expect.poll(async () => (await winState(app)).zoom).toBeGreaterThan(start);
  await pressItem(app, 'zoom-out');
  await pressItem(app, 'zoom-out');
  await expect.poll(async () => (await winState(app)).zoom).toBeLessThan(start);
  await pressItem(app, 'zoom-reset');
  await expect.poll(async () => (await winState(app)).zoom).toBe(0);
  await pressItem(app, 'fullscreen');
  await expect.poll(async () => (await winState(app)).fullscreen).toBe(true);
  await pressItem(app, 'fullscreen');
  await expect.poll(async () => (await winState(app)).fullscreen).toBe(false);
  await pressItem(app, 'minimize');
  await expect.poll(async () => (await winState(app)).minimized).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.restore());
});

test('undo, redo, cut, copy, paste and select all work in a field', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await settled(page);
  await pressItem(app, 'search');
  const field = page.getByRole('searchbox');
  await expect(field).toBeFocused();
  // On macOS the shell does these; elsewhere the field does, so the page's own keyboard is the right way to press them.
  const edit = async (id: string) => {
    if (mac) return pressItem(app, id);
    const { key, modifiers } = pressOf(HELP_SHORTCUTS.find((s) => s.id === id)!);
    return page.keyboard.press([...modifiers.map((m) => (m === 'control' ? 'Control' : 'Shift')), key.toUpperCase()].join('+'));
  };
  await page.keyboard.type('abc');
  await edit('undo');
  await expect(field).toHaveValue('');
  await edit('redo');
  await expect(field).toHaveValue('abc');
  await edit('select-all');
  await edit('cut');
  await expect(field).toHaveValue('');
  await edit('paste');
  await expect(field).toHaveValue('abc');
  await edit('select-all');
  await edit('copy');
  await page.keyboard.press('End');
  await edit('paste');
  await expect(field).toHaveValue('abc');
});

test('Control+Q quits (macOS handles Command+Q in its application menu, checked by hand)', async ({ session }) => {
  test.skip(mac, 'Command+Q is the macOS application menu, which a synthesised key press does not reach');
  const { app, page } = await session.launch();
  await signUp(page);
  await settled(page);
  const closed = app.waitForEvent('close');
  await pressItem(app, 'quit');
  await closed;
});

test('the window shortcut closes the window (or hides it, as the close setting says)', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await settled(page);
  await pressItem(app, 'close');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return w === undefined || w.isDestroyed() || !w.isVisible();
  }).catch(() => true)).toBe(true);
});

test('a shortcut pressed with Help open closes it and then runs; Lock locks and leaves no dialog', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await settled(page);
  await open(page);
  await pressItem(app, 'new-transaction');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Add transaction' }).getByRole('heading', { name: 'Add transaction' })).toBeVisible();
  await page.keyboard.press('Escape');
  await open(page);
  await pressItem(app, 'go-accounts');
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(() => path(page)).toBe('/accounts/');
  await open(page);
  await pressItem(app, 'lock');
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('in a narrow window the shortcut also closes the drawer that is open under Help', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await settled(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(480, 760));
  await page.getByRole('button', { name: 'Open menu' }).click();
  await open(page);
  await pressItem(app, 'new-transaction');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Add transaction' }).getByRole('heading', { name: 'Add transaction' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});

async function expectNoViolations(page: Page): Promise<void> {
  await page.evaluate(() => (document.documentElement.dataset['translucent'] = 'false'));
  await page.waitForFunction(() => document.querySelector('[data-enter],[data-leave],[data-closed]') === null, undefined, { timeout: 5_000 }).catch(() => undefined);
  const results = await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  test(`the Help dialog has no accessibility violations (${theme} theme)`, async ({ session }) => {
    const { page } = await session.launch();
    await signUp(page);
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    await open(page);
    await expectNoViolations(page);
  });
}

for (const [language, shortcutsHeading, newTransaction] of [['uk', 'Комбінації клавіш', 'Нова транзакція'], ['pl', 'Skróty klawiszowe', 'Nowa transakcja']] as const) {
  test(`the Help dialog is in ${language} and does not scroll sideways at a narrow width`, async ({ session }) => {
    const { app, page } = await session.launch();
    await signUp(page);
    await settled(page);
    await pressItem(app, 'go-settings');
    await page.locator('a[href="/settings/appearance/"]:visible').first().click();
    await page.locator('select[name="language"]').selectOption(language);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(480, 760));
    await page.getByRole('button', { name: 'Open menu' }).or(page.getByRole('button', { name: /Відкрити меню|Otwórz menu/ })).first().click();
    await page.getByRole('button', { name: language === 'uk' ? 'Довідка' : 'Pomoc', exact: true }).click();
    const d = page.getByRole('dialog');
    await expect(d.getByText(shortcutsHeading)).toBeVisible();
    await expect(d.getByText(newTransaction)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
}
