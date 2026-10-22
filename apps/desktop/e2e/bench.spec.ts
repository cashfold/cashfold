import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { go } from '../../../e2e/fixtures/nav.js';
import { PASSWORD, seed } from '../../../e2e/bench/seed.js';
import { APP_ORIGIN, expect, test } from './fixtures';

// The performance budgets of spec 001 (SC-008, FR-096) and the cold start of the desktop app (plan: within 3 seconds), measured in the shell.
// Opt in with BENCH=1: seeding 50,000 transactions takes several minutes. The page's CPU is slowed four times where the shell allows it
// (the reference device profile, research R-12); the worker that holds the database runs at this machine's speed, as in e2e/bench.

const enabled = process.env['BENCH'] === '1';
const TOTAL = Number(process.env['BENCH_TOTAL'] ?? 50_000);
const SLOWDOWN = Number(process.env['BENCH_CPU_SLOWDOWN'] ?? 4);
const COLD_START_MS = 3_000;
const DASHBOARD_MS = 2_000;
const ADD_MS = 200;

test.skip(!enabled, 'set BENCH=1 to run the benchmark');

test('cold start: the sign-in screen is up within 3 seconds of launching the app', async ({ session }) => {
  const started = Date.now();
  const { page } = await session.launch();
  await page.goto(`${APP_ORIGIN}/sign-in/`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const elapsed = Date.now() - started;
  process.stdout.write(`cold start to the sign-in screen: ${elapsed} ms\n`);
  expect(elapsed, `cold start took ${elapsed} ms`).toBeLessThanOrEqual(COLD_START_MS);
});

test('with 50,000 transactions the dashboard is ready in 2 s and a transaction is added in 200 ms', async ({ session }) => {
  test.setTimeout(1_800_000);
  const { page } = await session.launch();
  // The shared seeding addresses pages relative to a base URL; in the app they live on the app origin.
  const goto = page.goto.bind(page);
  page.goto = ((url: string, options?: Parameters<Page['goto']>[1]) => goto(url.startsWith('/') ? `${APP_ORIGIN}${url}` : url, options)) as Page['goto'];
  // A seeded profile can be kept between runs (CASHFOLD_E2E_USER_DATA names its folder): seeding takes minutes, measuring takes seconds.
  const marker = join(session.userDataDir, '.seeded');
  mkdirSync(session.userDataDir, { recursive: true });
  if (existsSync(marker)) process.stdout.write(`using the seeded profile in ${session.userDataDir}\n`);
  else {
    await seed(page, TOTAL);
    writeFileSync(marker, 'seeded');
  }
  await measure(page);
});

async function measure(page: Page): Promise<void> {
  if (await page.getByRole('button', { name: 'Lock', exact: true }).count()) await page.getByRole('button', { name: 'Lock', exact: true }).click();
  // Pressing Unlock at once after Lock with this many transactions loses the unlock call (the old worker is still closing the database); the same
  // happens in the web app (e2e/bench/dashboard-50k.spec.ts fails the same way). Not the shell's doing, so the measurement waits for the old worker to go.
  await page.waitForTimeout(5_000);
  await page.getByLabel('Password').fill(PASSWORD);
  let throttled = true;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN }).catch(() => {
    throttled = false;
  });
  process.stdout.write(throttled ? `page CPU slowed ${SLOWDOWN} times\n` : 'the shell does not allow slowing the CPU: measured at full speed\n');
  const unlocking = Date.now();
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toHaveCount(0, { timeout: 300_000 });
  process.stdout.write(`unlock with ${TOTAL} transactions: ${Date.now() - unlocking} ms\n`);

  const started = Date.now();
  await go(page, 'Overview');
  await expect(page.getByTestId('net-worth')).toBeVisible({ timeout: 60_000 });
  const dashboard = Date.now() - started;
  process.stdout.write(`dashboard with ${TOTAL} transactions: ${dashboard} ms\n`);

  await go(page, 'Transactions');
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel(/^Amount/).fill('12.34');
  const addStarted = Date.now();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
  const added = Date.now() - addStarted;
  process.stdout.write(`add transaction: ${added} ms\n`);

  if (throttled) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  expect(dashboard, `dashboard took ${dashboard} ms`).toBeLessThanOrEqual(DASHBOARD_MS);
  expect(added, `adding took ${added} ms`).toBeLessThanOrEqual(ADD_MS);
}
