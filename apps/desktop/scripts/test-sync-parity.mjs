// Runs the web-and-desktop sync test: builds the web app so that it may talk to a relay on this machine (a test-only content policy), builds the
// desktop app from that export, starts the real relay (in-memory store) and a static server for the web build, and runs sync-parity.spec.ts.
//
//   node scripts/test-sync-parity.mjs
// The export in apps/web/out is replaced by the test build; rebuild it normally afterwards (pnpm --filter @cashfold/web build).
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktop, '../..');
const webPort = Number(process.env.E2E_PORT ?? 3100);
const relayPort = Number(process.env.E2E_RELAY_PORT ?? 3200);
const webUrl = `http://localhost:${webPort}`;
const relayUrl = `http://localhost:${relayPort}`;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options, env: { ...env, ...options.env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The app only talks to the services it is told about (connect-src); the test relay is on localhost.
run('pnpm', ['--filter', '@cashfold/web', 'build'], { env: { CSP_CONNECT_SOURCES: 'http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*' } });
run('pnpm', ['--filter', '@cashfold/desktop', 'build']);
run('pnpm', ['--filter', '@cashfold/server', 'build']);

const children = [];
const start = (command, args, options) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options, env: { ...env, ...options.env } });
  children.push(child);
  return child;
};
const stopAll = () => children.forEach((c) => c.kill());
process.on('exit', stopAll);

start('node', [join(root, 'apps/server/dist/main.js')], {
  env: {
    PORT: String(relayPort), STORE: 'memory', MAIL: 'none', REGISTRATION: 'open', RATE_LIMIT_SCALE: '100',
    ALLOWED_ORIGINS: `${webUrl},app://cashfold`, SERVER_SECRET: 'e2e0'.repeat(16).replaceAll('e', '1'), PUBLIC_URL: webUrl,
  },
});
start('pnpm', ['exec', 'serve', '-l', String(webPort), 'apps/web/out'], {});

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error(`test-sync-parity: ${url} did not come up`);
  process.exit(1);
}
await waitFor(`${relayUrl}/healthz`);
await waitFor(webUrl);

const result = spawnSync('pnpm', ['exec', 'playwright', 'test', '-c', 'apps/desktop/e2e/playwright.config.ts', 'sync-parity', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...env, CASHFOLD_E2E_RELAY: relayUrl, CASHFOLD_E2E_WEB: webUrl },
});
stopAll();
process.exit(result.status ?? 1);
