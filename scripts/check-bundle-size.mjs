// Bundle budgets for the static export (research R-12), gzipped:
//   initial: the JavaScript the home page loads up front (scripts referenced by out/index.html)  <= 366 KiB
//   worker:  every other JavaScript chunk (Core Worker and lazily loaded code)                   <= 257 KiB
// The first targets (250 and 150 KiB) were set before the app existed. Measured at the end of the first release: 254.5 and 266.0 KiB, the
// worker holding the protocol schemas (zod), the SQLite and Argon2 glue and every command and query. These limits are the measurement plus
// about 6%: they stop growth, they do not claim the original targets were met (research.md R-12).
// After the interface redesign (spec 002) the measurement is 342.2 and 241.8 KiB: the signed-in shell, the kit and Headless UI are part of every
// page, so they sit in the initial chunks and the lazy ones shrank. Together that is 584.0 KiB, 63.5 KiB over the first release (520.5 KiB),
// inside the 70 KiB the redesign allowed (SC-010). The fonts (about 380 KiB of woff2) are static assets loaded on demand, and are not in either budget.
// The WASM modules are static assets, loaded on demand, and are not part of either budget.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUT = 'apps/web/out';
const INITIAL_BUDGET = Number(process.env.BUNDLE_INITIAL_BUDGET_BYTES ?? 366 * 1024);
const WORKER_BUDGET = Number(process.env.BUNDLE_WORKER_BUDGET_BYTES ?? 257 * 1024);

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
// Share of the kit: Headless UI writes `headlessui` into its data attributes and portal id, so a chunk that mentions it holds kit code. The
// figure is an upper bound (the whole chunk is counted), printed so growth is visible; the budgets below are unchanged until T114.
const KIT_MARKER = 'headlessui';
const initialUrls = new Set([...readFileSync(join(OUT, 'index.html'), 'utf8').matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]));
const all = [...walk(join(OUT, '_next/static'))]
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ url: `/${f.slice(OUT.length + 1)}`, size: gz(f), kit: readFileSync(f, 'utf8').includes(KIT_MARKER) }));

const initial = all.filter((f) => initialUrls.has(f.url)).reduce((n, f) => n + f.size, 0);
const worker = all.filter((f) => !initialUrls.has(f.url)).reduce((n, f) => n + f.size, 0);
console.log(`initial JS: ${initial} bytes gzipped (budget ${INITIAL_BUDGET})`);
console.log(`worker and lazy JS: ${worker} bytes gzipped (budget ${WORKER_BUDGET})`);
const kitShare = (inInitial) => all.filter((f) => f.kit && initialUrls.has(f.url) === inInitial).reduce((n, f) => n + f.size, 0);
console.log(`of which chunks holding the UI kit (Headless UI): initial ${kitShare(true)} bytes, lazy ${kitShare(false)} bytes gzipped (whole chunks, an upper bound)`);
const fontsDir = join(OUT, 'fonts');
if (existsSync(fontsDir)) {
  const fonts = readdirSync(fontsDir).filter((f) => f.endsWith('.woff2'));
  const bytes = fonts.reduce((n, f) => n + statSync(join(fontsDir, f)).size, 0);
  console.log(`fonts shipped: ${fonts.length} woff2 files, ${bytes} bytes (loaded on demand by unicode-range; the service worker precaches them for offline use)`);
}
const problems = [];
if (initial > INITIAL_BUDGET) problems.push('initial JS budget exceeded');
if (worker > WORKER_BUDGET) problems.push('worker JS budget exceeded');
if (initialUrls.size === 0) problems.push('no initial scripts found in index.html: the gate would measure nothing');
for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
