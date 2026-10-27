import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { createAccount } from '../../../e2e/fixtures/nav.js';
import { expect, readShellLog, signUp, test, unlock } from './fixtures';

// Spec 006, user story 6: links and files from outside only open the right screen for review. A second launch is simulated by the event the running copy
// receives (`second-instance` with the launch arguments), which is how the system hands them over.

const folder = mkdtempSync(join(tmpdir(), 'cashfold-intake-'));
const csvPath = join(folder, 'bank.csv');
const backupPath = join(folder, 'Household.cashfold-backup');
writeFileSync(csvPath, 'Date,Amount,Note\n2025-01-02,-3.50,Coffee\n2025-01-03,-12.00,Lunch\n');
writeFileSync(backupPath, 'not a real backup, only bytes to be chosen');
mkdirSync(join(folder, 'folder.csv'));
writeFileSync(join(folder, 'empty.csv'), '');
writeFileSync(join(folder, 'notes.txt'), 'x');

const secondLaunch = (app: ElectronApplication, ...args: string[]) =>
  app.evaluate(({ app: electronApp }, argv) => electronApp.emit('second-instance', {}, ['cashfold', ...argv], ''), args);
const queued = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __cashfoldTest: { intakeQueued(): number } }).__cashfoldTest.intakeQueued());

test('a CSV from a second launch opens the import with the file chosen, and imports nothing', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await createAccount(page, 'Everyday', '100.00');
  await secondLaunch(app, csvPath);
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/settings/data/');
  await expect(page.locator('#import-file')).toHaveValue(/bank\.csv$/);
  await expect(page.getByText('Date column')).toBeVisible();
  await expect(page.getByTestId('tx-row')).toHaveCount(0);
});

test('a backup opens the restore form with the file chosen and no passphrase, and restores nothing', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await secondLaunch(app, backupPath);
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/settings/data/');
  await expect(page.locator('#restore-file')).toHaveValue(/Household\.cashfold-backup$/);
  await expect(page.getByLabel('Passphrase').last()).toHaveValue('');
});

test('an open link goes to that screen', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await secondLaunch(app, 'cashfold://open/plan');
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/plan/');
});

test('files are held while the app is locked, and arrive after the unlock', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await app.evaluate(() => (globalThis as unknown as { __cashfoldTest: { emitPower(e: string): void } }).__cashfoldTest.emitPower('lock-screen'));
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
  await secondLaunch(app, csvPath);
  await expect.poll(() => queued(app)).toBe(1);
  expect(await page.evaluate(() => location.pathname)).not.toBe('/settings/data/');
  await unlock(page);
  await expect.poll(() => queued(app)).toBe(0);
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/settings/data/');
});

test.describe('what is refused is refused with a message, and changes nothing', () => {
  const cases: Array<[string, string, string]> = [
    ['a link with a secret', 'cashfold://add-device?secretKey=C1-AAAA-BBBB-CCCC', 'never carries a Secret Key'],
    ['a malformed link', 'cashfold://delete-everything', 'not one Cashfold can open'],
    ['a link with a fragment', 'cashfold://add-device?email=a%40b.example#x', 'not one Cashfold can open'],
    ['an empty file', join(folder, 'empty.csv'), 'is empty'],
    ['a directory', join(folder, 'folder.csv'), 'not an ordinary file'],
  ];
  for (const [name, argument, text] of cases) {
    test(name, async ({ session }) => {
      const { app, page } = await session.launch();
      await signUp(page);
      await secondLaunch(app, argument);
      await expect(page.getByText(text, { exact: false })).toBeVisible();
      expect(await page.evaluate(() => location.pathname)).not.toBe('/settings/data/');
      // Nothing of the item is in the log: only the kind, the decision and a reason code.
      const log = JSON.stringify(readShellLog(session.userDataDir));
      expect(log).not.toContain('AAAA');
      expect(log).not.toContain(folder);
    });
  }
});

test('an argument that is not ours is ignored, and an add-device link says the app already has an account', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await secondLaunch(app, join(folder, 'notes.txt'));
  await page.waitForTimeout(300);
  expect(await queued(app)).toBe(0);
  await secondLaunch(app, 'cashfold://add-device?email=a%40b.example');
  await expect(page.getByText('already has a Cashfold account')).toBeVisible();
});

test('a link to add a device, with no account yet, fills the email and the service address and never the Secret Key', async ({ session }) => {
  const { app, page } = await session.launch();
  await page.goto('app://cashfold/sign-up/');
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await secondLaunch(app, 'cashfold://add-device?email=a%40b.example&server=https%3A%2F%2Frelay.example.com');
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/add/');
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('a@b.example');
  await expect(page.getByLabel('Service address')).toHaveValue('https://relay.example.com');
  await expect(page.getByLabel('Secret Key', { exact: true })).toHaveValue('');
});

test('a second launch leaves one app process', async ({ session }) => {
  const { app } = await session.launch();
  await secondLaunch(app, 'cashfold://open/overview');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});
