// Runs the desktop app from source: builds main and preload, then starts Electron on the built web export (apps/desktop/dist/web).
//
//   pnpm --filter @cashfold/desktop dev
//   CASHFOLD_DEV_URL=http://localhost:3000 pnpm --filter @cashfold/desktop dev    # against `next dev` instead; ignored in a packaged app
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = spawnSync(process.execPath, [join(desktop, 'scripts/build.mjs')], { cwd: desktop, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const electron = createRequire(import.meta.url)('electron');
// ELECTRON_RUN_AS_NODE (set by editors and tools that are Electron apps themselves) would run the app as plain Node.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [desktop], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
