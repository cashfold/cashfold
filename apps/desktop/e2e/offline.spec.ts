import { createAccount, go } from '../../../e2e/fixtures/nav.js';
import { addExpense, APP_ORIGIN, expect, signUp, test, unlock } from './fixtures';

// Every request that leaves the machine goes to a proxy that is not there, which is what "no network" looks like to the app. The app's own
// pages come from the app: origin, not the network.
const NO_NETWORK = ['--proxy-server=http://127.0.0.1:9'];

// Constitution VII, FR-003: every local function works with no network at all, from the first launch.

test('works with the network cut: sign up, record, restart, unlock, read', async ({ session }) => {
  const first = await session.launch({ args: NO_NETWORK });
  // Prove the network really is gone for ordinary requests.
  expect(await first.page.evaluate(() => fetch('https://example.com/', { mode: 'no-cors' }).then(() => 'reached', () => 'unreachable'))).toBe('unreachable');

  await signUp(first.page);
  await createAccount(first.page, 'Wallet', '250.00');
  await addExpense(first.page, 'Wallet', '12.50', 'Offline coffee');
  await session.quit(first.app);

  const second = await session.launch({ args: NO_NETWORK });
  await second.page.goto(`${APP_ORIGIN}/transactions/`);
  await unlock(second.page);
  await go(second.page, 'Transactions');
  await expect(second.page.getByTestId('tx-row').filter({ hasText: 'Offline coffee' })).toHaveCount(1);
});
