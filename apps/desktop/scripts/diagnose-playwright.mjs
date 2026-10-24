// Starts and stops the packaged app through Playwright's Electron support, round after round, the way the packaged-app tests do, and times each
// stage; the full log of a stalled launch is printed (a diagnostic for CI, not a test).
//
//   DEBUG=pw:browser node scripts/diagnose-playwright.mjs <app executable> [rounds]
//
// Rounds alternate between ending the app with a graceful close and with a kill of its whole process tree, so a stall that follows one of them shows.
import { _electron as electron } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = process.argv[2];
const rounds = Number(process.argv[3] ?? 10);
if (!exe || !existsSync(exe)) {
  console.error('usage: diagnose-playwright.mjs <app executable> [rounds]');
  process.exit(2);
}
const base = process.env.RUNNER_TEMP ?? tmpdir();
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function killTree(app) {
  const child = app.process();
  const exited = new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', () => resolve())));
  if (process.platform === 'win32' && child.pid !== undefined) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
  await exited;
}

let stalled = 0;
for (let round = 1; round <= rounds; round++) {
  const mode = round % 2 === 1 ? 'graceful close' : 'tree kill';
  const dir = mkdtempSync(join(base, 'cashfold-pw-'));
  const t0 = Date.now();
  const mark = () => `${Date.now() - t0} ms`;
  try {
    const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${dir}`], env, timeout: 30_000 });
    const launched = mark();
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const windowed = mark();
    if (mode === 'graceful close') await app.close();
    else await killTree(app);
    console.log(`round ${round} (${mode}): launched ${launched}, window ${windowed}, ended ${mark()}`);
  } catch (error) {
    stalled++;
    console.log(`round ${round} (${mode}): FAILED after ${mark()}\n${String(error.message).split('\n').map((l) => `    ${l}`).join('\n')}`);
  }
  await sleep(500);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
console.log(`\n${rounds - stalled} of ${rounds} rounds started and ended cleanly, ${stalled} stalled`);
