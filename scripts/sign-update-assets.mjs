// Signs the installers that update themselves, for the release:  node scripts/sign-update-assets.mjs <folder>
//
// The folder is the one the release job assembled from the build artifacts: the installers, and the update feeds (latest.yml, latest-mac.yml,
// latest-linux.yml). For the Windows installer, both Mac zips and the AppImage it writes `<name>.sig` next to the file: the Ed25519 signature
// of "cashfold-update-v1\n<name>\n<sha512>" made with the key in the environment variable UPDATE_SIGNING_KEY (base64 PKCS#8; never an
// argument, so it cannot appear in a process list or a log line). Everything is checked before anything is written, so a failure leaves no
// half-signed release: each installer the feeds name must be present, and its SHA-512 must be the one the feed lists.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { signUpdate } from './lib/update-signature.mjs';

const FEEDS = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];
/** The installers that can update themselves; deb, rpm and dmg are updated by the system or by hand. */
const SELF_UPDATING = /\.(?:exe|zip|AppImage)$/;

function fail(message) {
  console.error(`sign-update-assets: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length !== 1) fail('usage: sign-update-assets.mjs <folder>  (the key is read from UPDATE_SIGNING_KEY, never from an argument)');
const folder = args[0];
const key = process.env.UPDATE_SIGNING_KEY;
if (key === undefined || key.trim() === '') fail('UPDATE_SIGNING_KEY is not set');

const plan = [];
for (const feedName of FEEDS) {
  const feedPath = join(folder, feedName);
  if (!existsSync(feedPath)) fail(`the update feed ${feedName} is missing`);
  const feed = parse(readFileSync(feedPath, 'utf8'));
  for (const file of feed.files ?? []) {
    const name = String(file.url).split('/').pop();
    if (!SELF_UPDATING.test(name)) continue;
    const path = join(folder, name);
    if (!existsSync(path)) fail(`${name} is listed in ${feedName} but is not in the folder`);
    const sha512 = createHash('sha512').update(readFileSync(path)).digest('base64');
    if (sha512 !== file.sha512) fail(`${name}: the SHA-512 in ${feedName} is not the SHA-512 of the file`);
    plan.push({ name, path, sha512 });
  }
}
if (plan.length === 0) fail('the update feeds list no installer that updates itself');

const signatures = [];
try {
  for (const item of plan) signatures.push({ ...item, signature: await signUpdate(key.trim(), item.name, item.sha512) });
} catch {
  fail('UPDATE_SIGNING_KEY is not a usable Ed25519 private key (base64 PKCS#8)');
}
for (const { path, signature } of signatures) writeFileSync(`${path}.sig`, `${signature}\n`);
console.log(`sign-update-assets: signed ${signatures.length} installers: ${signatures.map((s) => s.name).join(', ')}`);
