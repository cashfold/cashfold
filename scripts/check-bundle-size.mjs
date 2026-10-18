// Fails when the gzipped initial JS of the static export exceeds the budget (R-12).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUT = 'apps/web/out/_next/static';
const BUDGET_BYTES = Number(process.env.BUNDLE_BUDGET_BYTES ?? 300 * 1024);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

if (!existsSync(OUT)) {
  console.error(`check-bundle-size: ${OUT} not found; run the web build first`);
  process.exit(1);
}
let total = 0;
for (const f of walk(OUT)) if (f.endsWith('.js')) total += gzipSync(readFileSync(f)).length;
console.log(`gzipped JS: ${total} bytes (budget ${BUDGET_BYTES})`);
if (total > BUDGET_BYTES) {
  console.error('check-bundle-size: budget exceeded');
  process.exit(1);
}
