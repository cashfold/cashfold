// Fails when a production dependency has a licence outside the allowlist.
import { execFileSync } from 'node:child_process';

const ALLOWED = new Set(['MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'CC0-1.0', 'Python-2.0', 'Unlicense']);
// Reviewed build-time-only exceptions (not shipped in the client bundle). Add with a reason.
const EXCEPTIONS = new Set([
  'caniuse-lite', // CC-BY-4.0 browser data used by the CSS toolchain
  'lightningcss', // MPL-2.0 (file-level copyleft), CSS compiler pulled in by Tailwind
  'lightningcss-darwin-arm64',
  'lightningcss-darwin-x64',
  'lightningcss-linux-x64-gnu',
  'lightningcss-linux-x64-musl',
  'lightningcss-linux-arm64-gnu',
  'lightningcss-linux-arm64-musl',
]);
const out = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { encoding: 'utf8' });
const byLicense = JSON.parse(out);
const bad = Object.keys(byLicense).filter((l) =>
  l.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/).every((part) => !ALLOWED.has(part.trim())),
);
if (bad.length > 0) {
  let failed = false;
  for (const l of bad) {
    const names = byLicense[l]
      .map((p) => p.name)
      .filter((n) => !EXCEPTIONS.has(n) && !n.startsWith('@img/sharp-libvips-')); // optional next image-optimiser dep; unused with images.unoptimized
    if (names.length > 0) {
      failed = true;
      console.error(`disallowed licence ${l}: ${names.join(', ')}`);
    }
  }
  if (failed) process.exit(1);
}
console.log('licences ok');
