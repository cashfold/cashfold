import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { go, moreDetails } from '../../../e2e/fixtures/nav.js';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export { expect };

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const APP_ORIGIN = 'app://cashfold';
export const PASSWORD = 'correct horse battery staple';

/** The app under test: a packaged build when CASHFOLD_APP_EXECUTABLE is set, otherwise the built sources run by Electron. */
export function appUnderTest(): { executablePath: string; args: string[]; packaged: boolean } {
  const packaged = process.env['CASHFOLD_APP_EXECUTABLE'];
  if (packaged) return { executablePath: packaged, args: [], packaged: true };
  return { executablePath: createRequire(import.meta.url)('electron') as string, args: [desktopDir], packaged: false };
}

/**
 * The environment for the app under test. ELECTRON_RUN_AS_NODE (set by some editors and tools that are themselves Electron apps) would make
 * the app run as plain Node, with no `app` object, so it is always removed.
 */
function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env = { ...(process.env as Record<string, string>), ...extra };
  delete env['ELECTRON_RUN_AS_NODE'];
  return env;
}

/**
 * GitHub's Windows runners stall about every third launch of the app (Chromium reports "Access is denied" on its cache files, and
 * Playwright's connection to the app's DevTools port never completes), and the stalls come in runs. Three things are done there, and only there:
 * the data folders go on the runner's fast drive (RUNNER_TEMP, not the scanned system drive), helper processes a stuck launch leaves behind are
 * stopped between tests, and the GPU is off (the runners have none). On a developer's machine none of this applies: stopping every Cashfold
 * process there would close the real app.
 */
const onCiWindows = process.platform === 'win32' && Boolean(process.env['CI']);
const tempRoot = process.env['RUNNER_TEMP'] ?? tmpdir();

/** Every app any session of this run has started and not yet seen end. */
const liveApps = new Set<ElectronApplication>();

function stopLeftoverApps(): void {
  if (!onCiWindows) return;
  spawnSync('taskkill', ['/F', '/T', '/IM', basename(appUnderTest().executablePath)], { stdio: 'ignore' });
}

/** Stops leftover processes of an app that has ended, but only when no other app of this run is up (two are, on purpose, in some tests). */
function stopLeftoverAppsIfIdle(): void {
  if (liveApps.size === 0) stopLeftoverApps();
}

/**
 * Kills the app at once, with the processes it started. `ChildProcess.kill` ends only the main process; on Windows the helper processes live on
 * and keep the data folder open, so an app started on it afterwards finds the folder in use and fails to start.
 */
export async function killApp(app: ElectronApplication): Promise<void> {
  const child = app.process();
  const exited = new Promise<void>((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', () => resolve())));
  if (process.platform === 'win32' && child.pid !== undefined) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
  await exited;
}

const LAUNCH_TIMEOUT_MS = 12_000;
const LAUNCH_ATTEMPTS = 5;

/**
 * Starts the app, and starts it again when Playwright's start-up handshake never completes. On Linux in CI about one launch in ten leaves
 * `electron.launch` waiting for ever although the window is up and loaded (the app is fine; the test then waited out its whole timeout, two
 * minutes, for nothing). A normal launch takes well under two seconds, so one that has not finished in twelve is stopped and made again (up to five times), on the same data folder.
 */
async function launchWithRetry(options: { executablePath: string; args: string[]; env: Record<string, string> }, beforeRetry: () => void = () => undefined): Promise<ElectronApplication> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await electron.launch({ ...options, timeout: LAUNCH_TIMEOUT_MS });
    } catch (error) {
      if (attempt >= LAUNCH_ATTEMPTS) throw error;
      console.warn(`launch attempt ${attempt} did not finish in ${LAUNCH_TIMEOUT_MS / 1000} s, trying again`);
      beforeRetry();
      await new Promise((resolve) => setTimeout(resolve, 2_000)); // let the stopped app release its data folder
    }
  }
}

export interface Running {
  readonly app: ElectronApplication;
  readonly page: Page;
}

/**
 * One user-data folder and the instances started on it. `launch()` starts the app on that folder, `quit()` closes it, and launching again
 * is "restarting the app with the same data".
 */
export class Session {
  /** A fresh folder per session; CASHFOLD_E2E_USER_DATA names one to reuse (a seeded profile for the benchmark), which is then never deleted. */
  readonly userDataDir = process.env['CASHFOLD_E2E_USER_DATA'] ?? mkdtempSync(join(tempRoot, 'cashfold-e2e-'));
  private readonly running = new Set<ElectronApplication>();

  async launch(options: { args?: string[]; env?: Record<string, string> } = {}): Promise<Running> {
    const { executablePath, args } = appUnderTest();
    const app = await launchWithRetry(
      {
        executablePath,
        args: [...args, `--user-data-dir=${this.userDataDir}`, ...(onCiWindows ? ['--disable-gpu'] : []), ...(options.args ?? [])],
        env: cleanEnv(options.env),
      },
      // Only when no app is running: two apps of one test are sometimes up at the same time on purpose.
      stopLeftoverAppsIfIdle,
    );
    this.running.add(app);
    liveApps.add(app);
    app.on('close', () => {
      this.running.delete(app);
      liveApps.delete(app);
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    return { app, page };
  }

  async quit(app: ElectronApplication): Promise<void> {
    await app.close();
    this.running.delete(app);
    liveApps.delete(app);
    stopLeftoverAppsIfIdle(); // helper processes of the closed app may still hold its folder
  }

  async dispose(): Promise<void> {
    for (const app of this.running) await app.close().catch(() => undefined);
    for (const app of this.running) liveApps.delete(app);
    stopLeftoverAppsIfIdle();
    if (!process.env['CASHFOLD_KEEP_E2E_DATA'] && process.env['CASHFOLD_E2E_USER_DATA'] === undefined) {
      try {
        // Windows refuses to delete a folder while a process still has a file in it, and lets go a moment later.
        rmSync(this.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
      } catch (error) {
        // A leftover temp folder is not a failed test.
        console.warn(`could not remove ${this.userDataDir}: ${(error as Error).message}`);
      }
    }
  }
}

export const test = base.extend<{ session: Session }>({
  session: async ({}, use) => {
    stopLeftoverApps(); // from a test that timed out before it could clean up
    const session = new Session();
    await use(session);
    await session.dispose();
  },
});

/** Collects Content-Security-Policy and Trusted Types violations the page reports in its console, so a test can assert there were none. */
export function watchCsp(page: Page): { violations: string[] } {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to|Trusted Type/i.test(message.text())) violations.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (/Trusted Type|Content Security Policy/i.test(error.message)) violations.push(error.message);
  });
  return { violations };
}

/** Creates an account on the sign-up screen (the service address is a placeholder: nothing is contacted) and lands in the first Fold. */
export async function signUp(page: Page, email = 'alice@example.com', relay = 'https://relay.example.com'): Promise<string> {
  await page.goto(`${APP_ORIGIN}/sign-up/`);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByLabel('Service address').fill(relay);
  await page.getByRole('button', { name: 'Create account' }).click();
  const secret = page.getByTestId('secret-key');
  await expect(secret).toBeVisible({ timeout: 60_000 });
  const secretKey = (await secret.textContent())?.trim() ?? '';
  await page.getByLabel('I have saved my Secret Key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('current-fold')).toHaveText('Personal');
  return secretKey;
}

/** Unlocks the app after it was restarted (a restart always locks it). */
export async function unlock(page: Page, password = PASSWORD): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('current-fold')).toHaveText('Personal', { timeout: 30_000 });
}

/** Adds an expense through the Transactions screen's Add sheet. */
export async function addExpense(page: Page, account: string, amount: string, note: string): Promise<void> {
  await go(page, 'Transactions');
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Account').selectOption({ label: `${account} (USD)` });
  await dialog.getByLabel('Amount (USD)').fill(amount);
  await moreDetails(dialog);
  await dialog.getByLabel('Note').fill(note);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('tx-row').filter({ hasText: note })).toHaveCount(1);
}

/** The structured lines the shell wrote to its log in this session's user-data folder. */
export function readShellLog(userDataDir: string): Array<{ level: string; event: string; fields?: Record<string, unknown> }> {
  try {
    return readFileSync(join(userDataDir, 'logs', 'cashfold.log'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { level: string; event: string; fields?: Record<string, unknown> });
  } catch {
    return [];
  }
}
