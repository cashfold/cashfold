import type { ElectronApplication, Page } from '@playwright/test';
import { expect, signUp, test } from './fixtures';

// Spec 006, user story 7: the title bar is part of the app's own bar on macOS and Windows, and the system's on Linux. The window options are read
// through the test hooks; how it looks and feels (snap layouts, vibrancy and Mica, the traffic-light inset in full screen) is checked by hand
// on each system (verification V5).

const platform = process.platform;
const ownBar = platform === 'darwin' || platform === 'win32';

type Options = { titleBarStyle?: string; titleBarOverlay?: { color: string; symbolColor: string; height: number }; trafficLightPosition?: { x: number; y: number }; vibrancy?: string; backgroundMaterial?: string; backgroundColor?: string };
const windowOptions = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __cashfoldTest: { windowOptions(): Options } }).__cashfoldTest.windowOptions());
const root = (page: Page, name: string) => page.evaluate((key) => document.documentElement.dataset[key] ?? null, name);
const sendFrameState = (app: ElectronApplication, state: { fullscreen: boolean; maximized: boolean; translucent: boolean }) =>
  app.evaluate(({ BrowserWindow }, payload) => BrowserWindow.getAllWindows()[0]!.webContents.send('cashfold:frame-state', payload), state);

test('the window is created with the frame of its system', async ({ session }) => {
  const { app } = await session.launch();
  const options = await windowOptions(app);
  if (platform === 'darwin') {
    expect(options.titleBarStyle).toBe('hidden');
    expect(options.trafficLightPosition).toEqual({ x: 16, y: 14 });
  } else if (platform === 'win32') {
    expect(options.titleBarStyle).toBe('hidden');
    expect(options.titleBarOverlay).toMatchObject({ height: 40 });
  } else {
    expect(options.titleBarStyle).toBeUndefined();
    expect(options.titleBarOverlay).toBeUndefined();
  }
});

test('the page knows its platform and frame before it shows anything', async ({ session }) => {
  const { page } = await session.launch();
  expect(await root(page, 'platform')).toBe(platform);
  expect(await root(page, 'frame')).toBe(ownBar ? 'bar' : 'system');
  const height = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--frame-bar-h').trim());
  expect(height).toBe(ownBar ? '40px' : '0px');
});

test.describe('the bar', () => {
  test.skip(!ownBar, 'Linux keeps the system title bar: there is no bar of ours');

  test('is a drag region, and the controls in it do not drag', async ({ session }) => {
    const { page } = await session.launch();
    await page.goto('app://cashfold/sign-in/');
    const bar = page.getByTestId('frame-bar');
    await expect(bar).toBeAttached();
    expect(await bar.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('drag');
    await bar.evaluate((el) => el.insertAdjacentHTML('beforeend', '<button id="in-bar">x</button>'));
    expect(await page.locator('#in-bar').evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
  });

  test('keeps the traffic lights clear on macOS, and gives them back in full screen', async ({ session }) => {
    test.skip(platform !== 'darwin', 'the traffic lights are macOS');
    const { app, page } = await session.launch();
    await page.goto('app://cashfold/sign-in/');
    const inset = () => page.getByTestId('frame-bar').evaluate((el) => parseFloat(getComputedStyle(el).paddingInlineStart));
    expect(await inset()).toBeGreaterThanOrEqual(80);
    await sendFrameState(app, { fullscreen: true, maximized: false, translucent: false });
    await expect.poll(inset).toBeLessThan(20);
    await sendFrameState(app, { fullscreen: false, maximized: false, translucent: false });
    await expect.poll(inset).toBeGreaterThanOrEqual(80);
  });

  test('leaves room for the Windows buttons at the end of the bar', async ({ session }) => {
    test.skip(platform !== 'win32', 'the overlay is Windows');
    const { page } = await session.launch();
    await page.goto('app://cashfold/sign-in/');
    expect(await page.getByTestId('frame-bar').evaluate((el) => parseFloat(getComputedStyle(el).paddingInlineEnd))).toBeGreaterThan(0);
  });

  for (const [width, height, name] of [[800, 600, 'smallest'], [1280, 800, 'a wide']] as const) {
    test(`pushes the layout down by the bar, so nothing is under it, in the ${name} window, signed in`, async ({ session }) => {
      const { app, page } = await session.launch();
      await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w!, h!), [width, height]);
      await signUp(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      // The first thing in the page starts below the bar.
      expect(await page.evaluate(() => document.querySelector('main')!.getBoundingClientRect().top)).toBeGreaterThanOrEqual(40 - 1);
      // And nothing that is on screen starts under the bar: not the sidebar, not the page header of a narrow window, not the content.
      const highest = await page.evaluate(() =>
        Math.min(...Array.from(document.querySelectorAll('main, header, nav')).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0).map((r) => r.top)),
      );
      expect(highest).toBeGreaterThanOrEqual(40 - 1);
    });
  }

  test('turns the translucent sidebar off when the shell says the material is off (reduced transparency or high contrast)', async ({ session }) => {
    const { app, page } = await session.launch();
    await page.goto('app://cashfold/sign-in/');
    // The part of the page that listens loads a moment after the page; a state sent before it listens is lost, so it is sent until the page shows it.
    const shows = async (translucent: boolean) => {
      await sendFrameState(app, { fullscreen: false, maximized: false, translucent });
      return root(page, 'translucent');
    };
    await expect.poll(() => shows(true)).toBe('true');
    await expect.poll(() => shows(false)).toBe('false');
  });
});
