// Greps built money modules for floating-point use: Math.*, parseFloat, toFixed on amounts.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['packages/core/src', 'packages/protocol/src', 'apps/web/src/ui'];
const MONEY_PATH = /(\/money\/|\/ledger\/|\/budgeting\/|\/scheduling\/|shared-kernel\/(money|fx|rate|amount-text)|amount)/;
const PATTERNS = [/\bparseFloat\b/, /\bMath\./, /\.toFixed\(/];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let failures = 0;
for (const root of ROOTS.filter(existsSync)) {
  for (const f of walk(root)) {
    if (!/\.(ts|tsx)$/.test(f) || /\.test\./.test(f) || !MONEY_PATH.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const re of PATTERNS) {
      if (re.test(text)) {
        console.error(`${f}: matches ${re}`);
        failures++;
      }
    }
  }
}
if (failures > 0) process.exit(1);
console.log('no floating point in money modules');
