// Reproducible-build check (Constitution VIII, T190). Builds the web app twice from a clean state, hashes every file of the static
// export, and fails if the two builds differ. On success it writes SHA256SUMS (one line per file) and prints the digest of the
// whole tree, which the release publishes so anyone can rebuild the tag and compare.
//
//   node scripts/build-verify.mjs [--out dist-hashes] [--no-clean]
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestOfSums, hashTree, sumsOf } from './lib/tree-digest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const exportDir = join(root, 'apps/web/out');
const args = process.argv.slice(2);
const outDir = join(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'build-hashes');

function build(label) {
  if (!args.includes('--no-clean')) {
    rmSync(exportDir, { recursive: true, force: true });
    rmSync(join(root, 'apps/web/.next'), { recursive: true, force: true });
  }
  console.log(`build ${label} …`);
  execFileSync('pnpm', ['--filter', '@cashfold/web', 'build'], { cwd: root, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  return hashTree(exportDir);
}

const first = build('1 of 2');
const second = build('2 of 2');

const names = [...new Set([...Object.keys(first), ...Object.keys(second)])].sort();
const differing = names.filter((n) => first[n] !== second[n]);
if (differing.length > 0) {
  console.error(`\nThe two builds differ in ${differing.length} file(s):`);
  for (const n of differing.slice(0, 40)) console.error(`  ${n}\n    ${first[n] ?? '(missing)'}\n    ${second[n] ?? '(missing)'}`);
  process.exit(1);
}

const sums = sumsOf(first);
const digest = digestOfSums(sums);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'SHA256SUMS'), sums);
writeFileSync(join(outDir, 'TREE_SHA256'), `${digest}\n`);
console.log(`\nreproducible: ${names.length} files, tree digest ${digest}`);
