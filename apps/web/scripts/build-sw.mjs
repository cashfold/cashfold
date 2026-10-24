// Post-build: hash every file of the static export, write precache-manifest.json, and bundle the service worker
// with that manifest baked in. Run after `next build`.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const out = fileURLToPath(new URL('../out/', import.meta.url));
const EXCLUDE = new Set(['sw.js', 'precache-manifest.json']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const files = [...walk(out)]
  .map((p) => ({ url: `/${relative(out, p).split('\\').join('/')}`, path: p }))
  .filter((f) => !EXCLUDE.has(f.url.slice(1)))
  .map((f) => ({ url: f.url, sha256: createHash('sha256').update(readFileSync(f.path)).digest('hex') }))
  .sort((a, b) => (a.url < b.url ? -1 : 1));

const version = createHash('sha256').update(files.map((f) => `${f.url}:${f.sha256}`).join('\n')).digest('hex').slice(0, 16);
const manifest = { version, files };
writeFileSync(join(out, 'precache-manifest.json'), `${JSON.stringify(manifest)}\n`);

await build({
  entryPoints: [fileURLToPath(new URL('../src/sw/service-worker.ts', import.meta.url))],
  outfile: join(out, 'sw.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  define: { __MANIFEST__: JSON.stringify(manifest) },
});
console.log(`service worker built: ${files.length} files, version ${version}`);
