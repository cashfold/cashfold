// What a release contains and says. Used by the release workflow's last job:
//
//   node scripts/release-assets.mjs prepare <folder> --version 1.2.3 --commit <sha> --repository owner/name --signed true|false --changelog <file> --tree-digest <file>
//       writes SHA256SUMS (one line per file in the folder) and notes.md (the release page) into the folder
//   node scripts/release-assets.mjs verify <version>        (names of the assets that are on the release, one per line, on standard input)
//       exits non-zero, listing what is missing, unless the release has every asset it should (FR-022, FR-025)
//
// The pure parts (the list of assets, the checksum file, the notes) are exported and tested in release-notes.test.ts.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PLATFORMS = [
  { id: 'win-x64', label: 'Windows (64-bit)', formats: [['exe', 'installer']], selfUpdating: ['exe'] },
  { id: 'mac-arm64', label: 'macOS, Apple silicon', formats: [['dmg', 'disk image'], ['zip', 'zip, used by in-app updates']], selfUpdating: ['zip'] },
  { id: 'mac-x64', label: 'macOS, Intel', formats: [['dmg', 'disk image'], ['zip', 'zip, used by in-app updates']], selfUpdating: ['zip'] },
  { id: 'linux-x64', label: 'Linux (64-bit)', formats: [['AppImage', 'AppImage, portable and updates itself'], ['deb', 'deb package'], ['rpm', 'rpm package']], selfUpdating: ['AppImage'] },
];
const FEEDS = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];

/** The name of one installer: no spaces (GitHub rewrites them, which would break the update feed). */
const installerName = (version, platform, format) => `Cashfold-${version}-${platform}.${format}`;

/** Every file a complete release has. */
export function expectedAssets(version) {
  const installers = PLATFORMS.flatMap((p) => p.formats.map(([format]) => installerName(version, p.id, format)));
  const signatures = PLATFORMS.flatMap((p) => p.selfUpdating.map((format) => `${installerName(version, p.id, format)}.sig`));
  return [...installers, ...FEEDS, ...signatures, `cashfold-web-v${version}.tar.gz`, 'SHA256SUMS', 'SHA256SUMS.tree', 'TREE_SHA256', 'sbom.cdx.json'];
}

/** What a release lacks, sorted. */
export function missingAssets(version, present) {
  const have = new Set(present);
  return expectedAssets(version).filter((name) => !have.has(name)).sort();
}

/** The checksum file: "<sha256>  <name>" per file, in name order, each file once, so that `sha256sum -c` can check it. */
export function sha256Sums(files) {
  const byName = new Map();
  for (const { name, bytes } of files) byName.set(name, createHash('sha256').update(bytes).digest('hex'));
  return [...byName.keys()].sort().map((name) => `${byName.get(name)}  ${name}\n`).join('');
}

/** The release page: the changelog, how to download and check, the state of signing, and where the source and the web build come from. */
export function renderNotes({ version, changelog, treeDigest, commit, signed, assets, repository }) {
  const base = `https://github.com/${repository}`;
  const present = new Set(assets);
  const link = (name, label) => `[${label}](${base}/releases/download/v${version}/${name})`;
  const lines = [];
  if (!signed) {
    lines.push(
      '> **UNSIGNED BUILD.** These installers are not code-signed yet. Your system will warn you when you open them: on macOS open System Settings, Privacy & Security, and choose Open Anyway next to the message about Cashfold (on macOS 14 and earlier you can Control-click the app and choose Open instead); on Windows choose More info, then Run anyway. The app still checks the Cashfold project\'s own signature on every update it installs.',
      '',
    );
  }
  lines.push(changelog.trim(), '', '## Download', '');
  for (const platform of PLATFORMS) {
    const links = platform.formats.filter(([format]) => present.has(installerName(version, platform.id, format))).map(([format, label]) => link(installerName(version, platform.id, format), label));
    if (links.length > 0) lines.push(`- **${platform.label}**: ${links.join(' · ')}`);
  }
  lines.push(
    '',
    '## Check your download',
    '',
    '```bash',
    'sha256sum -c SHA256SUMS --ignore-missing',
    `gh attestation verify <file> --repo ${repository}`,
    '```',
    '',
    'Every file is listed in `SHA256SUMS`. The attestation shows which workflow run built the file, from which commit.',
    '',
    '## The web app, and the source',
    '',
    `The web app of this release has the tree digest (sha256) \`${treeDigest}\`. To check it, build the tagged commit yourself: \`BUILD_ID=${commit} node scripts/build-verify.mjs\` must print the same digest.`,
    '',
    `The source of this version: ${base}/tree/v${version}`,
    '',
  );
  return lines.join('\n');
}

function main(argv) {
  const [command, ...rest] = argv;
  const option = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  if (command === 'verify') {
    const version = rest[0];
    const names = readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    const missing = missingAssets(version, names);
    if (missing.length > 0) {
      console.error('The release is not complete, so it is not published. Missing:');
      for (const name of missing) console.error(`  - ${name}`);
      process.exit(1);
    }
    console.log(`release v${version}: all ${expectedAssets(version).length} assets are there`);
    return;
  }
  if (command === 'prepare') {
    const folder = rest[0];
    const version = option('--version');
    const required = ['--version', '--commit', '--repository', '--signed', '--changelog', '--tree-digest'];
    for (const name of required) if (option(name) === undefined) throw new Error(`${name} is required`);
    const names = readdirSync(folder).filter((n) => n !== 'SHA256SUMS' && n !== 'notes.md');
    writeFileSync(join(folder, 'SHA256SUMS'), sha256Sums(names.map((name) => ({ name, bytes: readFileSync(join(folder, name)) }))));
    const notes = renderNotes({
      version,
      changelog: readFileSync(option('--changelog'), 'utf8'),
      treeDigest: readFileSync(option('--tree-digest'), 'utf8').trim(),
      commit: option('--commit'),
      signed: option('--signed') === 'true',
      assets: [...names, 'SHA256SUMS'],
      repository: option('--repository'),
    });
    writeFileSync(join(folder, 'notes.md'), notes);
    console.log(`release v${version}: SHA256SUMS for ${names.length} files and notes.md written`);
    return;
  }
  console.error('usage: release-assets.mjs prepare <folder> … | verify <version>');
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
