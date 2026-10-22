import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { expect, test } from '../fixtures/index.js';
import { go } from '../fixtures/nav.js';
import { seed } from './seed.js';

// SC-010 (FR-027): with 10,000 transactions loaded in the list, narrowing it by search and loading more rows answer in under 200 ms at the 95th
// percentile. Same reference profile as the dashboard bench (Chromium, page CPU slowed four times). Opt in with BENCH=1; BENCH_PROFILE keeps the
// seeded profile between runs.

const enabled = process.env['BENCH'] === '1';
const TOTAL = 10_000;
const SLOWDOWN = Number(process.env['BENCH_CPU_SLOWDOWN'] ?? 4);
const P95_MS = 200;
const PAGE = 100;

const p95 = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]!;

test.describe('@bench 10,000 transactions in the list', () => {
  test.skip(!enabled, 'set BENCH=1 to run the benchmark');
  test.skip(({ browserName }) => browserName !== 'chromium', 'the reference profile is Chromium with the CPU slowed');
  test.setTimeout(1_800_000);

  test('searching and loading more answer within 200 ms at the 95th percentile', async ({}, testInfo) => {
    const profile = process.env['BENCH_PROFILE'] ?? mkdtempSync(join(tmpdir(), 'cashfold-bench-list-'));
    mkdirSync(profile, { recursive: true });
    const marker = join(profile, '.seeded');
    const context = await chromium.launchPersistentContext(profile, { baseURL: testInfo.project.use.baseURL!, serviceWorkers: 'block' });
    const page = context.pages()[0] ?? (await context.newPage());
    if (existsSync(marker)) await page.goto('/transactions/');
    else {
      await seed(page, TOTAL);
      writeFileSync(marker, 'seeded');
    }
    await go(page, 'Transactions');
    const more = page.getByRole('button', { name: /^Show more/ });
    const rows = page.getByTestId('tx-row');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });

    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });

    // Load every page, timing each click until the next batch of rows is on screen.
    const loadMs: number[] = [];
    for (let shown = PAGE; shown < TOTAL; shown += PAGE) {
      const started = Date.now();
      await more.click();
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid=tx-row]').length >= n, shown + PAGE, { timeout: 60_000 });
      loadMs.push(Date.now() - started);
    }
    process.stdout.write(`loaded ${await rows.count()} rows; load-more p95 ${p95(loadMs)} ms\n`);

    // Narrow by search with all of them loaded: from the keystroke to the narrowed list.
    const search = page.getByRole('searchbox').first();
    const searchMs: number[] = [];
    for (const term of ['Row 99', 'Payee 7', 'Row 5000', 'Payee 41', 'Row 12']) {
      await search.fill('');
      const started = Date.now();
      await search.fill(term);
      await page.waitForFunction((t) => [...document.querySelectorAll('[data-testid=tx-row]')].every((r) => r.textContent?.includes(t)), term, { timeout: 30_000 });
      searchMs.push(Date.now() - started);
    }
    process.stdout.write(`search p95 ${p95(searchMs)} ms\n`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await context.close();
    expect(p95(loadMs), 'load more').toBeLessThanOrEqual(P95_MS);
    expect(p95(searchMs), 'search').toBeLessThanOrEqual(P95_MS);
  });
});
