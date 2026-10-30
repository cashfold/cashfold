import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { expect } from '../fixtures/index.js';
import { go } from '../fixtures/nav.js';
import { choose } from '../fixtures/select.js';

// Seeding shared by the benchmarks: an account and a number of transactions brought in through the CSV import, which is the way a person gets that
// many in. Ten thousand rows go in per file.

export const PASSWORD = 'correct horse battery staple';
const NOWHERE = 'http://localhost:9';
const PER_FILE = 10_000;

export async function signUp(page: Page): Promise<void> {
  await page.goto('/sign-up/');
  await page.getByLabel('Email address', { exact: true }).fill(`bench+${Date.now().toString(36)}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByLabel('Keep everything on this device for now').uncheck();
  await page.getByLabel('Service address').fill(NOWHERE);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 90_000 });
  await page.getByLabel('I have saved my Secret Key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

export async function seed(page: Page, total: number): Promise<void> {
  await signUp(page);
  await go(page, 'Accounts');
  for (const name of ['Everyday', 'Savings']) {
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByLabel(/^Opening balance/).fill('1,000.00');
    await dialog.getByRole('button', { name: /^More options/ }).click();
    await dialog.getByLabel('Opening date').fill('2015-01-01');
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  const dir = mkdtempSync(join(tmpdir(), 'cashfold-bench-'));
  let seeded = 0;
  for (let f = 0; f < Math.ceil(total / PER_FILE); f++) {
    const rows = Math.min(PER_FILE, total - f * PER_FILE);
    const lines = ['date,amount,category,payee,note'];
    for (let i = 0; i < rows; i++) {
      const n = f * PER_FILE + i;
      const day = new Date(Date.UTC(2016, 0, 1) + (n % 3650) * 86_400_000).toISOString().slice(0, 10);
      lines.push(`${day},-${1 + (n % 97)}.${String(n % 100).padStart(2, '0')},,Payee ${n % 60},Row ${n},`);
    }
    const csv = join(dir, `seed-${f}.csv`);
    writeFileSync(csv, lines.join('\n'));
    await go(page, 'Data');
    const importing = page.getByRole('region', { name: 'Import from a CSV file' });
    await importing.getByLabel('CSV file').setInputFiles(csv);
    if (f > 0) await choose(importing.getByLabel('Import into account'), 'Everyday (USD)');
    await importing.getByRole('button', { name: 'Show what would be imported' }).click();
    await expect(page.getByTestId('import-preview')).toBeVisible({ timeout: 120_000 });
    await importing.getByRole('button', { name: 'Import these rows' }).click();
    await expect(page.getByTestId('import-result')).toContainText('Imported', { timeout: 600_000 });
    seeded += rows;
    process.stdout.write(`seeded ${seeded} of ${total}\n`);
  }
}
