import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { expect, test } from '../fixtures/index.js';
import { go } from '../fixtures/nav.js';
import { PASSWORD, seed } from './seed.js';

// SC-008 (FR-096): with 50,000 transactions the dashboard is ready in 2 seconds and adding a transaction takes 200 ms. Measured in Chromium with the
// page's CPU slowed four times (the reference device profile, research.md R-12). Chromium's throttle does not reach dedicated workers, which is
// where the database and the ledger live, so the worker runs at this machine's speed: the figures are for this machine, and research.md R-12
// says what that means for a slower device. Seeding goes through the CSV import, which is the way a person gets
// that many in. Opt in with BENCH=1: it takes several minutes. CI runs it in its own step.

const enabled = process.env['BENCH'] === '1';
const TOTAL = 50_000;
const SLOWDOWN = Number(process.env['BENCH_CPU_SLOWDOWN'] ?? 4);
const DASHBOARD_MS = 2_000;
const ADD_MS = 200;

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
      await page.goto('/overview/');
    } else {
      await seed(page, TOTAL);
      writeFileSync(marker, 'seeded');
    }
    await measure(page);
    await context.close();
  });
});

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
    await go(page, 'Overview');
    await expect(page.getByTestId('net-worth')).toBeVisible({ timeout: 60_000 });
    const dashboard = Date.now() - started;
    process.stdout.write(`dashboard with ${TOTAL} transactions at ${SLOWDOWN}x slowdown: ${dashboard} ms\n`);

    // Adding one: from pressing Add to the sheet closing and the list showing it.
    await go(page, 'Transactions');
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel(/^Amount/).fill('12.34');
    const addStarted = Date.now();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
    const added = Date.now() - addStarted;
    process.stdout.write(`add transaction: ${added} ms\n`);

    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    expect(dashboard, `dashboard took ${dashboard} ms`).toBeLessThanOrEqual(DASHBOARD_MS);
    expect(added, `adding took ${added} ms`).toBeLessThanOrEqual(ADD_MS);
}
