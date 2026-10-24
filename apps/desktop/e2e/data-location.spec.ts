import { createAccount, go } from '../../../e2e/fixtures/nav.js';
import { addExpense, APP_ORIGIN, expect, killApp, PASSWORD, Session, signUp, test, unlock } from './fixtures';

// User story 2: the person can see where the data is and open that folder (FR-009), the version and the source (FR-026), and a damaged or
// abruptly stopped session does not lose confirmed work (FR-007). The pages come from the web app; these tests prove them inside the shell.

test('Settings shows the version, the data folder and where the source of this version is', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await go(page, 'Advanced');
  const [version, userData] = await Promise.all([app.evaluate(({ app: electronApp }) => electronApp.getVersion()), app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))]);
  await expect(page.getByTestId('about-version')).toHaveText(version);
  await expect(page.getByTestId('about-data-path')).toHaveText(userData);
  await expect(page.getByTestId('about-build')).toBeVisible();
  await expect(page.getByRole('link', { name: 'The source of this version' })).toHaveAttribute('href', `https://github.com/cashfold/cashfold/tree/v${version}`);
  // A build made here is not signed, and says so rather than looking official.
  await expect(page.getByText('Not signed')).toBeVisible();
});

test('"Show in folder" opens exactly the data folder', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await go(page, 'Advanced');
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { __opened: string[] }).__opened = opened;
    shell.openPath = async (path: string) => {
      opened.push(path);
      return '';
    };
  });
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  await page.getByTestId('about-show-folder').click();
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)).toEqual([userData]);
});

test('a copy started on another data folder shows that folder', async () => {
  const other = new Session();
  try {
    const { app, page } = await other.launch();
    await signUp(page);
    await go(page, 'Advanced');
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    expect(userData).toContain(other.userDataDir.split('/').pop()!);
    await expect(page.getByTestId('about-data-path')).toHaveText(userData);
  } finally {
    await other.dispose();
  }
});

test('a change that was confirmed is there after the app is killed at once', async ({ session }) => {
  const first = await session.launch();
  await signUp(first.page);
  await createAccount(first.page, 'Everyday', '100.00');
  await addExpense(first.page, 'Everyday', '12.50', 'Coffee beans'); // confirmed: the sheet closed and the row shows
  // Killed with its helper processes and waited for: on a slow Windows machine they would still hold the data folder, and the second launch
  // would find it owned, hand over to it and exit (single instance).
  await killApp(first.app);
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  const second = await session.launch();
  await second.page.goto(`${APP_ORIGIN}/transactions/`);
  await unlock(second.page, PASSWORD);
  await go(second.page, 'Transactions');
  await expect(second.page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' })).toHaveCount(1, { timeout: 60_000 });
  await go(second.page, 'Accounts');
  await expect(second.page.getByTestId('account-row').filter({ hasText: 'Everyday' }).getByTestId('account-balance')).toHaveText('87.50 USD');
  await expect(second.page.getByTestId('recovery-notice')).toHaveCount(0); // nothing was damaged
});

test('a damaged database is kept and reported, and the app carries on', async ({ session }) => {
  const { page } = await session.launch();
  await signUp(page);
  await createAccount(page, 'Everyday', '100.00');
  await addExpense(page, 'Everyday', '12.50', 'Coffee beans');
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
  await page.waitForTimeout(1_500); // the worker lets go of the file

  // Overwrite 512 bytes in the middle of the encrypted database file, as a failing disk might (the same damage as e2e/storage-corruption.spec.ts).
  await expect(async () => {
    const damaged = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await (await root.getDirectoryHandle('cashfold')).getDirectoryHandle('.opaque');
      let done = false;
      for await (const [, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemFileHandle]> }).entries()) {
        const file = await handle.getFile();
        const path = new TextDecoder().decode(new Uint8Array(await file.slice(0, 512).arrayBuffer())).split('\0')[0];
        if (path !== '/cashfold.db') continue;
        const middle = 4096 + 4096 * Math.floor((file.size - 4096) / 4096 / 2);
        const writable = await (handle as unknown as { createWritable(o: { keepExistingData: boolean }): Promise<FileSystemWritableFileStream> }).createWritable({ keepExistingData: true });
        await writable.seek(middle);
        await writable.write(crypto.getRandomValues(new Uint8Array(512)));
        await writable.close();
        done = true;
      }
      return done;
    });
    expect(damaged).toBe(true);
  }).toPass({ timeout: 20_000 });

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  const notice = page.getByTestId('recovery-notice');
  await expect(notice).toBeVisible({ timeout: 60_000 });
  await expect(notice).toContainText('could not be read');
  await notice.getByRole('button', { name: 'I have read this' }).click();
  // The app carries on and shows its screens, rather than stopping on the damaged file (with no service there is nothing to fetch the old data from).
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('recovery-notice')).toHaveCount(0);
});
