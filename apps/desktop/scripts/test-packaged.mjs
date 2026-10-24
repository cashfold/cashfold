// Builds an unpacked app for this machine and runs the end-to-end tests against it (what a user would run, not the sources).
//
//   node scripts/test-packaged.mjs [-- playwright arguments, e.g. a test file name]
//
// The app is packaged like a release except that the Node-inspector fuse stays on, because Playwright attaches to the main process that
// way (CASHFOLD_TEST_BUILD). The release fuse values are checked on the real release build by scripts/check-fuses.mjs.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const platform = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const env = { ...process.env, CASHFOLD_TEST_BUILD: '1' };
delete env.ELECTRON_RUN_AS_NODE;

function run(command, args, extraEnv = env) {
  // On Windows `pnpm` is pnpm.cmd, which cannot be started without a shell; the other commands are paths that may hold spaces, so they get none.
  const result = spawnSync(command, args, { cwd: desktop, stdio: 'inherit', env: extraEnv, shell: command === 'pnpm' && process.platform === 'win32' });
  if (result.error) console.error(`test-packaged: could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [join(desktop, 'scripts/build.mjs')]);
run(process.execPath, [join(desktop, 'scripts/package.mjs'), '--dir', `--${platform}`, `--${arch}`]);

/** Where electron-builder puts the unpacked app on each platform. */
function executable() {
  const release = join(desktop, 'release');
  if (platform === 'mac') {
    const folder = arch === 'arm64' ? 'mac-arm64' : 'mac';
    return join(release, folder, 'Cashfold.app/Contents/MacOS/Cashfold');
  }
  if (platform === 'win') return join(release, 'win-unpacked/Cashfold.exe');
  const folder = join(release, 'linux-unpacked');
  const name = readdirSync(folder).find((f) => f.toLowerCase() === 'cashfold');
  return join(folder, name ?? 'cashfold');
}

/**
 * Chromium's sandbox on Linux needs its helper to be owned by root with the setuid bit, which an unpacked build does not have. Set it when
 * we can (CI has passwordless sudo); without it the app refuses to start rather than run unsandboxed, which is the behaviour we want to test.
 */
function prepareLinuxSandbox(app) {
  const helper = join(dirname(app), 'chrome-sandbox');
  if (!existsSync(helper) || process.getuid?.() === 0) return;
  for (const args of [['chown', 'root:root', helper], ['chmod', '4755', helper]]) {
    const done = spawnSync('sudo', ['-n', ...args], { stdio: 'inherit' });
    if (done.status !== 0) {
      console.warn(`test-packaged: could not set up chrome-sandbox (${args.join(' ')}); the app may not start on this machine`);
      return;
    }
  }
}

const app = executable();
if (!existsSync(app)) {
  console.error(`test-packaged: expected the unpacked app at ${app}`);
  process.exit(1);
}
if (platform === 'linux') prepareLinuxSandbox(app);
const rest = process.argv.slice(2).filter((arg) => arg !== '--');
run('pnpm', ['exec', 'playwright', 'test', '-c', 'e2e/playwright.config.ts', ...rest], { ...env, CASHFOLD_APP_EXECUTABLE: app });
