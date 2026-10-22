// Builds the desktop app's code into apps/desktop/dist: the main process and the preload script (bundled with esbuild), and a verified copy
// of the web app's static export (apps/web/out). Packaging into installers is a separate step (scripts/package.mjs, electron-builder).
//
//   node scripts/build.mjs [--signed] [--test-feed] [--version 1.2.3]
//
// --signed       the installers made from this build will be code-signed (the app reports itself as signed)
// --test-feed    the manual unsigned test build: lets the updater read a local feed. Never for a release (check-desktop-config).
// --version      override the version (tests); by default the root package.json version, the one place the release version is written.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeDigest } from '../../../scripts/lib/tree-digest.mjs';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktop, '../..');
const webOut = join(root, 'apps/web/out');
const dist = join(desktop, 'dist');
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

if (!existsSync(join(webOut, 'index.html'))) {
  console.error('desktop build: apps/web/out/index.html is missing. Build the web app first: pnpm --filter @cashfold/web build');
  process.exit(1);
}

const version = option('--version') ?? process.env.CASHFOLD_VERSION ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const signed = args.includes('--signed');
const testFeed = args.includes('--test-feed');
if (signed && testFeed) {
  console.error('desktop build: --signed and --test-feed cannot be combined (a test feed is never part of a release)');
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });

// Without --test-feed, constants are folded and the dead branches go (minifySyntax only: names stay readable), so the test feed's code is not in a release at all.
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning', sourcemap: 'linked', legalComments: 'none', minifySyntax: !testFeed };
await build({
  ...common,
  entryPoints: [join(desktop, 'src/main/index.ts')],
  outfile: join(dist, 'main/index.cjs'),
  external: ['electron', 'electron-updater'],
  define: {
    __CASHFOLD_SIGNED__: JSON.stringify(signed),
    __CASHFOLD_TEST_FEED_ENABLED__: JSON.stringify(testFeed),
    __CASHFOLD_VERSION__: JSON.stringify(version),
  },
});
await build({
  ...common,
  entryPoints: [join(desktop, 'src/preload/index.ts')],
  outfile: join(dist, 'preload/index.cjs'),
  external: ['electron'],
});

// The web export, verbatim. The copy must hash to the same tree digest as the original: this is the export that the web release published.
mkdirSync(join(dist, 'web'), { recursive: true });
cpSync(webOut, join(dist, 'web'), { recursive: true });
const expected = treeDigest(webOut);
const actual = treeDigest(join(dist, 'web'));
if (expected !== actual) {
  console.error(`desktop build: the copied web export differs from apps/web/out (${actual} != ${expected})`);
  process.exit(1);
}
writeFileSync(join(dist, 'web.digest'), `${actual}\n`);
// The commit the web export was built from (BUILD_ID is what the web build uses too; CI sets it to the commit).
const commit = process.env.BUILD_ID ?? process.env.GITHUB_SHA ?? '';
writeFileSync(join(dist, 'build-info.json'), `${JSON.stringify({ version, commit, signed, testFeed, webDigest: actual }, null, 2)}\n`);

console.log(`desktop build: version ${version}${signed ? ', signed' : ''}${testFeed ? ', test feed' : ''}, web export ${actual.slice(0, 12)}…`);
