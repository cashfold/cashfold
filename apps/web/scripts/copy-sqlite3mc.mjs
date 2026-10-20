// Copies the reviewed SQLite3 Multiple Ciphers artifacts into public/sqlite3mc/ so they are served byte for byte.
// The bundler never sees them: the Core Worker imports them from their URL at run time. Fails if a file differs from
// the hash recorded in vendor/sqlite3mc.sha256 (see ADR-0002).
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules/@aztec/sqlite3mc-wasm/vendor/jswasm');
const to = join(root, 'public/sqlite3mc');
const wanted = new Set(['sqlite3.mjs', 'sqlite3.wasm']);

const manifest = new Map(
  readFileSync(join(root, 'vendor/sqlite3mc.sha256'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+/).reverse()),
);

mkdirSync(to, { recursive: true });
for (const file of wanted) {
  const actual = createHash('sha256').update(readFileSync(join(from, file))).digest('hex');
  if (actual !== manifest.get(file)) throw new Error(`${file} does not match the reviewed upstream hash`);
  copyFileSync(join(from, file), join(to, file));
}
console.log(`sqlite3mc: ${wanted.size} verified files copied to public/sqlite3mc/`);
