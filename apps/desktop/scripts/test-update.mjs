// Runs the update tests: a build with the test feed (the app may read a local feed and trust a throwaway key; a release never can), the
// update spec against it, and then the normal build again so that nothing is left behind that could be mistaken for a release.
//
//   node scripts/test-update.mjs [-- playwright arguments]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = (command, args, extra = {}) => spawnSync(command, args, { cwd: desktop, stdio: 'inherit', env: { ...env, ...extra } });

if (run(process.execPath, [join(desktop, 'scripts/build.mjs'), '--test-feed']).status !== 0) process.exit(1);
const rest = process.argv.slice(2).filter((arg) => arg !== '--');
const result = run('pnpm', ['exec', 'playwright', 'test', '-c', 'e2e/playwright.config.ts', 'update.spec.ts', ...rest], { CASHFOLD_UPDATE_TEST: '1' });
run(process.execPath, [join(desktop, 'scripts/build.mjs')]);
process.exit(result.status ?? 1);
