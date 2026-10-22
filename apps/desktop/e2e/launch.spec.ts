import { APP_ORIGIN, expect, test, watchCsp } from './fixtures';

// User story 1: the app opens in its own window and shows the sign-in screen, with no policy violation.
test('the desktop app opens its own window on the app origin', async ({ session }) => {
  const { app, page } = await session.launch();
  const csp = watchCsp(page);
  await page.goto(`${APP_ORIGIN}/sign-in/`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => location.origin)).toBe(APP_ORIGIN);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  expect(await app.evaluate(({ app: electronApp }) => electronApp.getName())).toBe('Cashfold');
  expect(csp.violations).toEqual([]);
});

test('every page of the export loads from the app origin without violations', async ({ session }) => {
  const { page } = await session.launch();
  const csp = watchCsp(page);
  for (const route of ['/sign-in/', '/sign-up/', '/recover/']) {
    const response = await page.goto(`${APP_ORIGIN}${route}`);
    expect(response?.status(), route).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }), route).toBeVisible();
  }
  expect(csp.violations).toEqual([]);
});
