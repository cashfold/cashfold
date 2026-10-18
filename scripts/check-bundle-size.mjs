// Bundle budgets for the static export (research R-12), gzipped:
//   initial: the JavaScript the home page loads up front (scripts referenced by out/index.html)  <= 250 KB
//   worker:  every other JavaScript chunk (Core Worker and lazily loaded code)                   <= 150 KB
// The WASM modules are static assets, loaded on demand, and are not part of either budget.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUT = 'apps/web/out';
const INITIAL_BUDGET = Number(process.env.BUNDLE_INITIAL_BUDGET_BYTES ?? 250 * 1024);
const WORKER_BUDGET = Number(process.env.BUNDLE_WORKER_BUDGET_BYTES ?? 150 * 1024);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

if (!existsSync(join(OUT, 'index.html'))) {
  console.error(`check-bundle-size: ${OUT}/index.html not found; run the web build first`);
  process.exit(1);
}
const gz = (path) => gzipSync(readFileSync(path)).length;
const initialUrls = new Set([...readFileSync(join(OUT, 'index.html'), 'utf8').matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]));
const all = [...walk(join(OUT, '_next/static'))].filter((f) => f.endsWith('.js')).map((f) => ({ url: `/${f.slice(OUT.length + 1)}`, size: gz(f) }));

const initial = all.filter((f) => initialUrls.has(f.url)).reduce((n, f) => n + f.size, 0);
const worker = all.filter((f) => !initialUrls.has(f.url)).reduce((n, f) => n + f.size, 0);
console.log(`initial JS: ${initial} bytes gzipped (budget ${INITIAL_BUDGET})`);
console.log(`worker and lazy JS: ${worker} bytes gzipped (budget ${WORKER_BUDGET})`);
const problems = [];
if (initial > INITIAL_BUDGET) problems.push('initial JS budget exceeded');
if (worker > WORKER_BUDGET) problems.push('worker JS budget exceeded');
if (initialUrls.size === 0) problems.push('no initial scripts found in index.html: the gate would measure nothing');
for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
