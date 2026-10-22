import { createAccount, go } from '../../../e2e/fixtures/nav.js';
import { APP_ORIGIN, expect, signUp, test, unlock, watchCsp } from './fixtures';

// User stories 1 and 2: the encrypted database works inside the desktop app and what is saved survives a restart (FR-007, R-D-05).

test('data created in the app is still there after the app is quit and started again', async ({ session }) => {
  const first = await session.launch();
  const csp = watchCsp(first.page);
  await signUp(first.page);
  await createAccount(first.page, 'Savings', '1000.00');
  await go(first.page, 'Accounts');
  await expect(first.page.getByRole('link', { name: 'Savings', exact: true })).toBeVisible();
  await session.quit(first.app);

  // A restart always locks the app: unlock with the password, then the account is there.
  const second = await session.launch();
  await second.page.goto(`${APP_ORIGIN}/accounts/`);
  await unlock(second.page);
  await go(second.page, 'Accounts');
  await expect(second.page.getByRole('link', { name: 'Savings', exact: true })).toBeVisible();
  expect(csp.violations).toEqual([]);
});

test('the browser engine keeps the data: persistent storage is granted', async ({ session }) => {
  const { page } = await session.launch();
  await signUp(page);
  // The app asks for persistent storage once it is unlocked (apps/web/src/adapters/storage-persistence.ts); the shell must grant it.
  await expect.poll(() => page.evaluate(() => navigator.storage.persisted()), { timeout: 15_000 }).toBe(true);
});

test('a wrong password does not open the data', async ({ session }) => {
  const first = await session.launch();
  await signUp(first.page);
  await session.quit(first.app);
  const second = await session.launch();
  await second.page.goto(`${APP_ORIGIN}/accounts/`);
  await expect(second.page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 30_000 });
  await second.page.getByLabel('Password').fill('this is not my password');
  await second.page.getByRole('button', { name: 'Unlock' }).click();
  await expect(second.page.locator('form [role=alert]')).toContainText('not right');
});
