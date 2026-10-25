// Guards the desktop app's identity and release configuration (spec 003, research R-D-05, R-D-08, R-D-10):
//  - apps/desktop/package.json keeps version 0.0.0: the release version comes only from the root package (one writer);
//  - the packaging configuration takes its app id and product name from src/main/identity.json (they are frozen once released: the user-data
//    folder and the updater depend on them), so it must agree with identity.json;
//  - with --release (or RELEASE_BUILD=1) there must be one or two raw Ed25519 update public keys, and the packaging configuration must exist.
// Run in CI after the other cheap gates: `pnpm check:desktop-config`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** @returns {Promise<string[]>} the problems found, empty when the configuration is sound */
export async function checkDesktopConfig({ root, release = false, env = process.env }) {
  const problems = [];
  const desktop = join(root, 'apps/desktop');

  const pkg = readJson(join(desktop, 'package.json'));
  if (pkg.version !== '0.0.0') problems.push(`apps/desktop/package.json version is "${pkg.version}"; it must stay "0.0.0" (the release version comes from the root package.json)`);

  const identity = readJson(join(desktop, 'src/main/identity.json'));
  const builderPath = join(desktop, 'electron-builder.config.mjs');
  if (existsSync(builderPath)) {
    const builder = (await import(`${pathToFileURL(builderPath).href}?t=${Date.now()}`)).default;
    if (builder.appId !== identity.appId) problems.push(`electron-builder.config.mjs appId "${builder.appId}" differs from identity.json "${identity.appId}"; changing it moves every user's data`);
    if (builder.productName !== identity.name) problems.push(`electron-builder.config.mjs productName "${builder.productName}" differs from identity.json name "${identity.name}"; changing it moves every user's data`);
    if (release) {
      const targets = (builder.mac?.target ?? []).map((t) => (typeof t === 'string' ? t : t.target));
      if (!targets.includes('zip')) problems.push('electron-builder.config.mjs builds no Mac zip: in-app updates on macOS install the zip that latest-mac.yml describes');
    }
  } else if (release) {
    problems.push('apps/desktop/electron-builder.config.mjs is missing');
  }

  if (release) {
    const keys = identity.updatePublicKeys ?? [];
    if (keys.length === 0) problems.push('identity.json updatePublicKeys is empty: a release must trust at least one update-signing key (ADR-0010)');
    else if (keys.length > 2) problems.push('identity.json updatePublicKeys has more than two keys: at most two (current and next) may be trusted');
    else if (keys.some((k) => typeof k !== 'string' || Buffer.from(k, 'base64').length !== 32 || Buffer.from(k, 'base64').toString('base64') !== k)) problems.push('identity.json updatePublicKeys must be raw 32-byte Ed25519 public keys in base64');
  }
  if (release) {
    // A release is never made with the test conveniences: the local update feed (an update-hijack switch if it shipped) or the inspector fuse.
    if (env.CASHFOLD_TEST_BUILD === '1') problems.push('CASHFOLD_TEST_BUILD is set: that build keeps the Node-inspector fuse on and is only for the packaged-app tests');
    const info = join(desktop, 'dist/build-info.json');
    if (existsSync(info) && readJson(info).testFeed === true) problems.push('apps/desktop/dist was built with --test-feed: a release must not contain the test feed');
    const bundle = join(desktop, 'dist/main/index.cjs');
    if (existsSync(bundle) && readFileSync(bundle, 'utf8').includes('CASHFOLD_TEST_')) problems.push('the main-process bundle contains the test feed switches (CASHFOLD_TEST_…): a release must not');
    if (existsSync(bundle) && readFileSync(bundle, 'utf8').includes('__cashfoldTest')) problems.push('the main-process bundle contains the packaged-test hooks (__cashfoldTest): a release must not');
    if (existsSync(info) && readJson(info).testHooks === true) problems.push('apps/desktop/dist was built with the test hooks: a release must not contain them');
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const release = process.argv.includes('--release') || process.env.RELEASE_BUILD === '1';
  const problems = await checkDesktopConfig({ root, release });
  if (problems.length > 0) {
    console.error('Desktop configuration problems:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`desktop configuration: ok${release ? ' (release)' : ''}`);
}
