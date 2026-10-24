// Packages the built app (apps/desktop/dist) with electron-builder. Nothing is published.
//
//   node scripts/package.mjs [--dir] [--mac|--win|--linux] [--arch x64|arm64]   (anything else is passed to electron-builder)
// --dir builds the unpacked app only (fast; what the packaged-app tests run).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutEmptyCredentials } from '../../../scripts/lib/credential-env.mjs';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
// On Windows `pnpm` is pnpm.cmd, which cannot be started without a shell (and a failed start used to end here as a silent exit 1).
const result = spawnSync('pnpm', ['exec', 'electron-builder', '--config', 'electron-builder.config.mjs', '--publish', 'never', ...process.argv.slice(2).filter((arg) => arg !== '--')], {
  cwd: desktop,
  stdio: 'inherit',
  env: withoutEmptyCredentials(process.env),
  shell: process.platform === 'win32',
});
if (result.error) console.error(`package: could not start pnpm: ${result.error.message}`);
process.exit(result.status ?? 1);
