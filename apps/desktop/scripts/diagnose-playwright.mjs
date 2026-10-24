// Starts and stops the packaged app through Playwright's Electron support, round after round, the way the packaged-app tests do, and times each
// stage; the full log of a stalled launch is printed (a diagnostic for CI, not a test).
//
//   DEBUG=pw:browser node scripts/diagnose-playwright.mjs <app executable> [rounds]
//
// Rounds alternate between ending the app with a graceful close and with a kill of its whole process tree, so a stall that follows one of them shows.
import { _electron as electron } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, lstatSync, readFileSync, rmSync } from 'node:fs';
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

/** What the app left in its data folder: whether its main process got as far as logging that it started, and what else it wrote. */
function describeFolder(dir) {
  const lines = [];
  const walk = (folder, depth) => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      const info = lstatSync(path);
      if (info.isDirectory()) {
        if (depth < 1) walk(path, depth + 1);
        else lines.push(`${path.slice(dir.length + 1)}${'\\'}`);
      } else lines.push(`${path.slice(dir.length + 1)} (${info.size} bytes)`);
    }
  };
  try {
    walk(dir, 0);
    const logs = join(dir, 'logs');
    const logText = existsSync(logs) ? readdirSync(logs).map((f) => readFileSync(join(logs, f), 'utf8')).join('\n') : '';
    return `    data folder: ${lines.join(', ') || '(empty)'}\n    main process logged app.start: ${logText.includes('app.start') ? 'YES (it was ready)' : 'NO (it never got ready)'}\n    log tail: ${logText.trim().split('\n').slice(-4).join(' | ') || '(no log)'}`;
  } catch (error) {
    return `    could not read the data folder: ${error.message}`;
  }
}

let stalled = 0;
for (let round = 1; round <= rounds; round++) {
  const mode = round % 2 === 1 ? 'graceful close' : 'tree kill';
  const dir = mkdtempSync(join(base, 'cashfold-pw-'));
  const t0 = Date.now();
  const mark = () => `${Date.now() - t0} ms`;
  try {
    const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${dir}`], env, timeout: Number(process.env.DIAG_LAUNCH_TIMEOUT_MS ?? 15_000) });
    const launched = mark();
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const windowed = mark();
    if (mode === 'graceful close') await app.close();
    else await killTree(app);
    console.log(`round ${round} (${mode}): launched ${launched}, window ${windowed}, ended ${mark()}`);
  } catch (error) {
    stalled++;
    console.log(`round ${round} (${mode}): FAILED after ${mark()}\n${String(error.message).split('\n').map((l) => `    ${l}`).join('\n')}\n${describeFolder(dir)}`);
  }
  await sleep(500);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
console.log(`\n${rounds - stalled} of ${rounds} rounds started and ended cleanly, ${stalled} stalled`);
