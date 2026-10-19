import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { expect, test } from '../fixtures/index.js';

// SC-008 (FR-096): with 50,000 transactions the dashboard is ready in 2 seconds and adding a transaction takes 200 ms. Measured in Chromium with the
// page's CPU slowed four times (the reference device profile, research.md R-12). Chromium's throttle does not reach dedicated workers, which is
// where the database and the ledger live, so the worker runs at this machine's speed: the figures are for this machine, and research.md R-12
// says what that means for a slower device. Seeding goes through the CSV import, which is the way a person gets
// that many in. Opt in with BENCH=1: it takes several minutes. CI runs it in its own step.

const enabled = process.env['BENCH'] === '1';
const PASSWORD = 'correct horse battery staple';
const NOWHERE = 'http://localhost:9';
const TOTAL = 50_000;
const PER_FILE = 10_000;
const SLOWDOWN = Number(process.env['BENCH_CPU_SLOWDOWN'] ?? 4);
const DASHBOARD_MS = 2_000;
const ADD_MS = 200;
const go = (page: Page, name: string) => page.getByRole('navigation').getByRole('link', { name, exact: true }).click();

test.describe('@bench 50,000 transactions', () => {
  test.skip(!enabled, 'set BENCH=1 to run the benchmark');
  test.skip(({ browserName }) => browserName !== 'chromium', 'the reference profile is Chromium with the CPU slowed');
  test.setTimeout(1_800_000);

  test('the dashboard is ready in 2 s and a transaction is added in 200 ms', async ({}, testInfo) => {
    // The seeded profile is kept between runs when BENCH_PROFILE names a folder: seeding takes minutes, measuring takes seconds.
    const profile = process.env['BENCH_PROFILE'] ?? mkdtempSync(join(tmpdir(), 'cashfold-bench-profile-'));
    mkdirSync(profile, { recursive: true });
    const marker = join(profile, '.seeded');
    const context = await chromium.launchPersistentContext(profile, { baseURL: testInfo.project.use.baseURL!, serviceWorkers: 'block' });
    const page = context.pages()[0] ?? (await context.newPage());
    if (existsSync(marker)) {
      process.stdout.write(`using the seeded profile in ${profile}\n`);
      await page.goto('/dashboard/');
    } else {
      await seed(page);
      writeFileSync(marker, 'seeded');
    }
    await measure(page);
    await context.close();
  });
});

async function seed(page: Page): Promise<void> {
    await page.goto('/sign-up/');
    await page.getByLabel('Email address', { exact: true }).fill(`bench+${Date.now().toString(36)}@example.com`);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByLabel('Service address').fill(NOWHERE);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 90_000 });
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await go(page, 'Accounts');
    for (const name of ['Everyday', 'Savings']) {
      await page.getByRole('button', { name: 'Add account', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Name', { exact: true }).fill(name);
      await dialog.getByLabel('Opening balance (USD)').fill('1,000.00');
      await dialog.getByLabel('Opening date').fill('2015-01-01');
      await dialog.getByRole('button', { name: 'Create account' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }

    // Seed through the importer: ten files of 10,000 rows spread over ten years, in 60 categories-worth of payees.
    const dir = mkdtempSync(join(tmpdir(), 'cashfold-bench-'));
    let seeded = 0;
    for (let f = 0; f < TOTAL / PER_FILE; f++) {
      const lines = ['date,amount,category,payee,note'];
      for (let i = 0; i < PER_FILE; i++) {
        const n = f * PER_FILE + i;
        const day = new Date(Date.UTC(2016, 0, 1) + (n % 3650) * 86_400_000).toISOString().slice(0, 10);
        lines.push(`${day},-${1 + (n % 97)}.${String(n % 100).padStart(2, '0')},,Payee ${n % 60},Row ${n},`);
      }
      const csv = join(dir, `seed-${f}.csv`);
      writeFileSync(csv, lines.join('\n'));
      await go(page, 'Data');
      const importing = page.getByRole('region', { name: 'Import from a CSV file' });
      await importing.getByLabel('CSV file').setInputFiles(csv);
      if (f > 0) await importing.getByLabel('Import into account').selectOption({ label: 'Everyday (USD)' });
      await importing.getByRole('button', { name: 'Show what would be imported' }).click();
      await expect(page.getByTestId('import-preview')).toBeVisible({ timeout: 120_000 });
      await importing.getByRole('button', { name: 'Import these rows' }).click();
      await expect(page.getByTestId('import-result')).toContainText('Imported', { timeout: 600_000 });
      seeded += PER_FILE;
      process.stdout.write(`seeded ${seeded} of ${TOTAL}\n`);
    }
}

async function measure(page: Page): Promise<void> {
    // Lock and unlock so nothing is warm, then slow the CPU down to the reference profile.
    if (await page.getByRole('button', { name: 'Lock', exact: true }).count()) await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await page.getByLabel('Password').fill(PASSWORD);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
    const unlocking = Date.now();
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toHaveCount(0, { timeout: 300_000 });
    process.stdout.write(`unlock with ${TOTAL} transactions at ${SLOWDOWN}x slowdown: ${Date.now() - unlocking} ms\n`);

    const started = Date.now();
    await go(page, 'Dashboard');
    await expect(page.getByTestId('net-worth')).toBeVisible({ timeout: 60_000 });
    const dashboard = Date.now() - started;
    process.stdout.write(`dashboard with ${TOTAL} transactions at ${SLOWDOWN}x slowdown: ${dashboard} ms\n`);

    // Adding one: from pressing the button to the dialog closing and the list showing it.
    await go(page, 'Transactions');
    await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Account').selectOption({ label: 'Everyday (USD)' });
    await dialog.getByLabel('Amount (USD)').fill('12.34');
    await dialog.getByLabel('Note').fill('Benchmark entry');
    const addStarted = Date.now();
    await dialog.getByRole('button', { name: 'Add transaction' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
    const added = Date.now() - addStarted;
    process.stdout.write(`add transaction: ${added} ms\n`);

    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    expect(dashboard, `dashboard took ${dashboard} ms`).toBeLessThanOrEqual(DASHBOARD_MS);
    expect(added, `adding took ${added} ms`).toBeLessThanOrEqual(ADD_MS);
}
