import type { ElectronApplication, Page } from '@playwright/test';
import { APP_ORIGIN, expect, test } from './fixtures';

// Spec 006, user story 2: the window is in the app's colours and follows the theme the page chooses, and the system's under "System". That the
// very first frame of a real dark system is dark is checked by eye (verification list); the colour the window is created with is in appearance.test.ts.

const LIGHT = '#ffffff';
const DARK = '#09090b';

/** A window with a translucent material (macOS vibrancy, Windows Mica) has no colour of its own, so the system reports it as black: the material follows `nativeTheme`. */
const translucentWindow = (app: ElectronApplication) =>
  app.evaluate(() => {
    const options = (globalThis as unknown as { __cashfoldTest: { windowOptions(): { vibrancy?: string; backgroundMaterial?: string } } }).__cashfoldTest.windowOptions();
    return options.vibrancy !== undefined || options.backgroundMaterial !== undefined;
  });
const expectedColour = async (app: ElectronApplication, colour: string) => ((await translucentWindow(app)) ? '#000000' : colour);

const backgroundOf = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor().toLowerCase());

/** The page's own preference (where Settings keeps it), then a reload so the page reads it and tells the shell. */
async function chooseTheme(page: Page, theme: 'system' | 'light' | 'dark'): Promise<void> {
  await page.goto(`${APP_ORIGIN}/sign-in/`);
  await page.evaluate((value) => localStorage.setItem('cashfold.ui', JSON.stringify({ v: 1, theme: value })), theme);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

for (const [theme, expected] of [
  ['dark', DARK],
  ['light', LIGHT],
] as const) {
  test(`the page's ${theme} theme colours the window ${expected}, whatever the system says`, async ({ session }) => {
    const { app, page } = await session.launch();
    await chooseTheme(page, theme);
    await expect.poll(() => backgroundOf(app)).toBe(await expectedColour(app, expected));
  });
}

test('under "system" the window follows the system theme within a second', async ({ session }) => {
  const { app, page } = await session.launch();
  await chooseTheme(page, 'system');
  // The page tells the shell its choice a moment after it loads (and that sets the native theme to "system" again), so the system theme is moved after that.
  await page.waitForTimeout(1_000);
  // `themeSource` is what "system" is read from; moving it is how a test stands in for the person changing the system theme.
  await app.evaluate(({ nativeTheme }) => void (nativeTheme.themeSource = 'dark'));
  await expect.poll(() => backgroundOf(app), { timeout: 1_000 }).toBe(await expectedColour(app, DARK));
  await app.evaluate(({ nativeTheme }) => void (nativeTheme.themeSource = 'light'));
  await expect.poll(() => backgroundOf(app), { timeout: 1_000 }).toBe(await expectedColour(app, LIGHT));
});

// Spec 014, user story 2: the dock and window icon follow the primary colour the page chooses, without a restart.
const iconOf = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __cashfoldTest: { appIcon(): string | undefined } }).__cashfoldTest.appIcon());

test("the page's primary colour reaches the shell, and the icon follows it within a second of a change", async ({ session }) => {
  const { app, page } = await session.launch();
  await page.goto(`${APP_ORIGIN}/sign-in/`);
  await page.evaluate(() => localStorage.setItem('cashfold.ui', JSON.stringify({ v: 1, primary: 'violet' })));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(() => iconOf(app), { timeout: 5_000 }).toBe('violet');
});
