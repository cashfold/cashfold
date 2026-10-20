// Supply-chain check: the SQLite3 Multiple Ciphers WASM we ship must be byte-identical to the upstream release.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = readFileSync('apps/web/vendor/sqlite3mc.sha256', 'utf8')
  .split('\n')
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => l.split(/\s+/));

const pkgDir = join(process.cwd(), 'apps/web/node_modules/@aztec/sqlite3mc-wasm');
let failed = false;
for (const [expected, file] of manifest) {
  const path = join(pkgDir, 'vendor/jswasm', file);
  const actual = existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'missing';
  const ok = actual === expected;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file}`);
  if (!ok) failed = true;
}
if (failed) {
  console.error('sqlite3mc artifacts differ from the reviewed upstream release');
  process.exit(1);
}
