// Bundle budgets for the static export (research R-12), gzipped:
//   initial: the JavaScript the home page loads up front (scripts referenced by out/index.html)  <= 367 KiB
//   worker:  every other JavaScript chunk (Core Worker and lazily loaded code)                   <= 278 KiB
// The first targets (250 and 150 KiB) were set before the app existed. Measured at the end of the first release: 254.5 and 266.0 KiB, the
// worker holding the protocol schemas (zod), the SQLite and Argon2 glue and every command and query. These limits are the measurement plus
// about 6%: they stop growth, they do not claim the original targets were met (research.md R-12).
// After the interface redesign (spec 002) the measurement is 342.2 and 241.8 KiB: the signed-in shell, the kit and Headless UI are part of every
// page, so they sit in the initial chunks and the lazy ones shrank. Together that is 584.0 KiB, 63.5 KiB over the first release (520.5 KiB),
// inside the 70 KiB the redesign allowed (SC-010). The fonts (about 380 KiB of woff2) are static assets loaded on demand, and are not in either budget.
// The WASM modules are static assets, loaded on demand, and are not part of either budget.
// The desktop experience (spec 006) added the shell's page side: shortcuts, drops, reminders, the intake of files and links, the frame bar and the
// desktop settings. Every one of those modules is loaded by a dynamic import that runs only inside the desktop app (ui/desktop/lazy.tsx), so a browser
// never downloads them and the initial budget did not move (358,045 against 374,784 bytes); but this budget counts every lazy chunk, and it rose from
// 262,057 to 276,393 bytes (about 14 KB). It is now 278 KiB, the measurement plus about 4%.
// Signing out (spec 011) added the confirmation and its rules, the use case, the eraser and the signed-out screen. The confirmation, the screen, the
// Emergency Kit module (which holds the QR generator, the largest single piece of the interface, about 8 KB gzipped) and the passkey code are loaded
// on first use, because the unlock form and the page gate are carried by every route and the build copies what they import into each route's chunk.
// Before that the QR generator was in five chunks and the passkey code in 17, about 60 KB gzipped between them. The measurement is now 259,920
// bytes, well inside the limit, which did not need to move (the initial budget is 365,292 against 374,784).
// Language catalogues (spec 004) are data, not code, and a person downloads only the one they use (the service worker precaches them all for
// offline use). They are counted apart from the worker budget and each is held to its own limit, so a new language cannot hide code growth and
// code growth cannot hide in a language.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUT = 'apps/web/out';
// 367 KiB (was 366): math in amount fields (spec 020) adds about 0.8 KB to the initial chunk (the sum check, the amount field's result line and
// their English strings; the evaluator itself is a lazy chunk), and CI measures about 0.6 KB more than a laptop build of the same code.
const INITIAL_BUDGET = Number(process.env.BUNDLE_INITIAL_BUDGET_BYTES ?? 367 * 1024);
const WORKER_BUDGET = Number(process.env.BUNDLE_WORKER_BUDGET_BYTES ?? 278 * 1024);
const CATALOGUE_BUDGET = Number(process.env.BUNDLE_CATALOGUE_BUDGET_BYTES ?? 40 * 1024);
// A catalogue chunk is a JSON module whose first key is the first error message.
const CATALOGUE_MARKER = /JSON\.parse\('\{"error\.InvalidAmount"/;

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
  .map((f) => {
    const text = readFileSync(f, 'utf8');
    return { url: `/${f.slice(OUT.length + 1)}`, size: gz(f), kit: text.includes(KIT_MARKER), catalogue: CATALOGUE_MARKER.test(text) };
  });

const initial = all.filter((f) => initialUrls.has(f.url)).reduce((n, f) => n + f.size, 0);
const catalogues = all.filter((f) => f.catalogue && !initialUrls.has(f.url));
const worker = all.filter((f) => !initialUrls.has(f.url) && !f.catalogue).reduce((n, f) => n + f.size, 0);
console.log(`initial JS: ${initial} bytes gzipped (budget ${INITIAL_BUDGET})`);
console.log(`worker and lazy JS: ${worker} bytes gzipped (budget ${WORKER_BUDGET})`);
console.log(`language catalogues: ${catalogues.map((f) => f.size).join(', ') || 'none'} bytes gzipped, one per language (budget ${CATALOGUE_BUDGET} each)`);
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
// Offline (principle VII): everything that can be fetched later, a language catalogue included, must be in the service worker's precache.
const manifestPath = join(OUT, 'precache-manifest.json');
if (existsSync(manifestPath)) {
  const cached = new Set(JSON.parse(readFileSync(manifestPath, 'utf8')).files.map((f) => f.url));
  for (const f of all) if (!cached.has(f.url)) problems.push(`${f.url} is not in the offline precache${f.catalogue ? ' (a language catalogue)' : ''}`);
}
for (const f of catalogues) if (f.size > CATALOGUE_BUDGET) problems.push(`language catalogue ${f.url} exceeds its budget`);
if (initialUrls.size === 0) problems.push('no initial scripts found in index.html: the gate would measure nothing');
for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
