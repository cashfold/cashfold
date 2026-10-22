import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { containsAmount, containsBytes, encodings } from '../../../e2e/fixtures/leak-scan.js';
import { chooseFold, createAccount, go } from '../../../e2e/fixtures/nav.js';
import { addExpense, expect, Session, signUp, test } from './fixtures';

// User story 2, FR-010 and Clarification 2: a backup is a file the person saves where they choose, it is encrypted (nothing readable in it),
// and it restores on another installation with the passphrase. The save dialog is answered by the test driver, which is what a person
// choosing a place does.

const PASSPHRASE = 'backup passphrase 1';
const ACCOUNT = 'Marmalade Savings';
const NOTE = 'Quartz Kiosk Purchase';

test('a backup is encrypted, and puts the data back on a clean installation', async ({ session }) => {
  const first = await session.launch();
  await signUp(first.page);
  await createAccount(first.page, ACCOUNT, '500.00');
  await addExpense(first.page, ACCOUNT, '7777.77', NOTE);

  const target = join(session.userDataDir, '..', `backup-${Date.now()}.cashfold-backup`);
  // The driver answers the native save dialog: choosing a path means no dialog is shown.
  await first.app.evaluate(({ session: electronSession }, path) => {
    electronSession.defaultSession.on('will-download', (_event, item) => item.setSavePath(path));
  }, target);

  await go(first.page, 'Data');
  const backup = first.page.getByRole('region', { name: 'Encrypted backup' });
  await backup.getByLabel('Passphrase', { exact: true }).first().fill(PASSPHRASE);
  await backup.getByLabel('Passphrase again').fill(PASSPHRASE);
  await backup.getByRole('button', { name: 'Make a backup' }).click();
  await expect.poll(() => existsSync(target) && statSync(target).size > 0, { timeout: 30_000 }).toBe(true);
  await expect(first.page.getByText('The backup was saved.')).toBeVisible();

  // Nothing readable is in the file.
  const bytes = new Uint8Array(readFileSync(target));
  for (const text of [ACCOUNT, NOTE, 'Personal']) for (const needle of encodings(text)) expect(containsBytes(bytes, needle), text).toBe(false);
  const latin1 = Buffer.from(bytes).toString('latin1');
  for (const amount of ['7777.77', '777777', '500.00', '50000']) expect(containsAmount(latin1, amount), amount).toBe(false);
  await session.quit(first.app);

  // A clean installation: a new data folder, a new account. The backup comes back as a new Fold.
  const clean = new Session();
  try {
    const second = await clean.launch();
    await signUp(second.page, 'bob@example.com');
    await restore(second.page, target, PASSPHRASE);
    await expect(second.page.getByTestId('restored')).toContainText('(restored)', { timeout: 60_000 });
    await go(second.page, 'Transactions');
    await chooseFold(second.page, 'Personal (restored)', 'Transactions');
    await expect(second.page.getByTestId('tx-row').filter({ hasText: NOTE })).toHaveCount(1, { timeout: 30_000 });
    await go(second.page, 'Accounts');
    await expect(second.page.getByTestId('account-row').filter({ hasText: ACCOUNT }).getByTestId('account-balance')).toHaveText('−7,277.77 USD');
  } finally {
    await clean.dispose();
  }
});

test('a wrong passphrase restores nothing', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await createAccount(page, 'Everyday', '100.00');
  const target = join(session.userDataDir, '..', `backup-wrong-${Date.now()}.cashfold-backup`);
  await app.evaluate(({ session: electronSession }, path) => {
    electronSession.defaultSession.on('will-download', (_event, item) => item.setSavePath(path));
  }, target);
  await go(page, 'Data');
  const backup = page.getByRole('region', { name: 'Encrypted backup' });
  await backup.getByLabel('Passphrase', { exact: true }).first().fill(PASSPHRASE);
  await backup.getByLabel('Passphrase again').fill(PASSPHRASE);
  await backup.getByRole('button', { name: 'Make a backup' }).click();
  await expect.poll(() => existsSync(target) && statSync(target).size > 0, { timeout: 30_000 }).toBe(true);

  await restore(page, target, 'not the passphrase');
  await expect(page.getByTestId('restored')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Encrypted backup' }).getByRole('alert').last()).toBeVisible();
});

async function restore(page: Page, file: string, passphrase: string): Promise<void> {
  await go(page, 'Data');
  const region = page.getByRole('region', { name: 'Encrypted backup' });
  await region.getByLabel('Backup file').setInputFiles(file);
  await region.getByLabel('Passphrase', { exact: true }).last().fill(passphrase);
  await region.getByRole('button', { name: 'Restore', exact: true }).click();
}
