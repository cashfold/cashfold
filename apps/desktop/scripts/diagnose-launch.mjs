// Measures how the packaged app starts, outside Playwright, to find where a stalled launch gets stuck (a diagnostic for CI, not a test).
//
//   node scripts/diagnose-launch.mjs <path to the app executable> [runs per variant]
//
// For every variant of the command line it starts the app on a fresh data folder, and times: the "DevTools listening" line, an HTTP request to
// the DevTools port, a WebSocket connection to the browser endpoint, and the app's own "app.start" log line (its main process is ready).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { cpus, freemem, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

const exe = process.argv[2];
const runs = Number(process.argv[3] ?? 4);
if (!exe || !existsSync(exe)) {
  console.error('usage: diagnose-launch.mjs <app executable> [runs]');
  process.exit(2);
}
const base = process.env.RUNNER_TEMP ?? tmpdir();
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const variants = [
  { name: 'both flags (what Playwright passes)', args: ['--inspect=0', '--remote-debugging-port=0'] },
  { name: 'remote debugging only', args: ['--remote-debugging-port=0'] },
  { name: 'inspect only', args: ['--inspect=0'] },
  { name: 'both flags, GPU off', args: ['--inspect=0', '--remote-debugging-port=0', '--disable-gpu'] },
  { name: 'no flags', args: [] },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => 'timeout')]);

function environment() {
  console.log(`platform ${process.platform} ${process.arch}, node ${process.version}, ${cpus().length} cpus, ${Math.round(freemem() / 2 ** 20)} of ${Math.round(totalmem() / 2 ** 20)} MiB free`);
  if (process.platform !== 'win32') return;
  const ps = (command) => spawnSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).stdout.trim();
  console.log(`Defender: ${ps('Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, AntivirusEnabled | Format-List | Out-String')}`.replace(/\s+/g, ' '));
  console.log(`Defender exclusions: ${ps('(Get-MpPreference).ExclusionPath -join "; "')} | processes: ${ps('(Get-MpPreference).ExclusionProcess -join "; "')}`);
  console.log(`temp folder: ${base}`);
}

function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
}

function appStarted(dir) {
  const logs = join(dir, 'logs');
  if (!existsSync(logs)) return false;
  return readdirSync(logs).some((f) => readFileSync(join(logs, f), 'utf8').includes('app.start'));
}

async function once(variant) {
  const dir = mkdtempSync(join(base, 'cashfold-diag-'));
  const t0 = Date.now();
  const since = () => `${Date.now() - t0} ms`;
  const out = { devtools: 'n/a', http: 'n/a', ws: 'n/a', appStart: 'timeout' };
  let stderr = '';
  let devtoolsUrl;
  const child = spawn(exe, [...variant.args, `--user-data-dir=${dir}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => undefined);
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    const found = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr);
    if (found && devtoolsUrl === undefined) {
      devtoolsUrl = found[1];
      out.devtools = since();
    }
  });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(`exited with code ${code} after ${since()}`)));

  if (variant.args.some((a) => a.startsWith('--remote-debugging-port'))) {
    for (let waited = 0; devtoolsUrl === undefined && waited < 30_000; waited += 100) await sleep(100);
    if (devtoolsUrl === undefined) out.devtools = 'timeout (30 s)';
    else {
      const port = new URL(devtoolsUrl).port;
      const t1 = Date.now();
      const http = await within(fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.status), 15_000);
      out.http = http === 'timeout' ? 'timeout (15 s)' : `${http} in ${Date.now() - t1} ms`;
      const t2 = Date.now();
      const ws = await within(
        new Promise((resolve) => {
          const socket = new WebSocket(devtoolsUrl);
          socket.onopen = () => (socket.close(), resolve('connected'));
          socket.onerror = () => resolve('error');
        }),
        15_000,
      );
      out.ws = ws === 'timeout' ? 'timeout (15 s)' : `${ws} in ${Date.now() - t2} ms`;
    }
  }
  for (let waited = 0; !appStarted(dir) && waited < 20_000; waited += 250) {
    if ((await within(exited, 250)) !== 'timeout') break;
  }
  if (appStarted(dir)) out.appStart = since();
  else if ((await within(exited, 1)) !== 'timeout') out.appStart = await exited;

  killTree(child);
  await within(exited, 5_000);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  return out;
}

environment();
for (const variant of variants) {
  console.log(`\n== ${variant.name}`);
  for (let run = 1; run <= runs; run++) {
    const r = await once(variant);
    console.log(`  run ${run}: devtools line ${r.devtools} | http ${r.http} | websocket ${r.ws} | app.start ${r.appStart}`);
    await sleep(1_000);
  }
}
