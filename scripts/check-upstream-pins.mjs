// Compares the things Cashfold pins on purpose, and that Dependabot cannot update, with what upstream has now:
//
//   - the Rust toolchain that builds the SRP module (packages/crypto/wasm/srp-bigint/rust-toolchain.toml);
//   - the `crypto-bigint` crate behind it (Cargo.toml). Cargo is left out of .github/dependabot.yml because CI rebuilds the module and compares
//     its bytes, so a bump is done by hand; this is what reminds a person that one is due;
//   - the Node major used by the relay image (deploy/Dockerfile.server), against that major's end-of-life date.
//
// It prints Markdown for an issue and exits 0 when every pin is current, 3 when something is behind, and 1 when it could not find out.
//   node scripts/check-upstream-pins.mjs [--markdown <file>]
// The weekly workflow (.github/workflows/upstream-pins.yml) opens one issue while something is behind and closes it when nothing is.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The Rust toolchain is allowed to lag this many minor releases (a release every six weeks) before it is reported. */
export const RUST_MINOR_LAG = 2;
/** A Node major is reported this many days before its end-of-life date. */
export const NODE_EOL_WARNING_DAYS = 90;

export const FILES = {
  rust: 'packages/crypto/wasm/srp-bigint/rust-toolchain.toml',
  cargo: 'packages/crypto/wasm/srp-bigint/Cargo.toml',
  docker: 'deploy/Dockerfile.server',
  nvmrc: '.nvmrc',
};

export const SOURCES = {
  rust: 'https://static.rust-lang.org/dist/channel-rust-stable.toml',
  crate: 'https://crates.io/api/v1/crates/crypto-bigint',
  node: 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json',
};

/** `1.99.1` as [1, 99, 1]. Anything that is not three numbers gives undefined. */
export const parseVersion = (text) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text).trim());
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
};

/** Negative when a is older than b, zero when they are equal, positive when a is newer. */
export const compareVersions = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const must = (value, what) => {
  if (value === undefined) throw new Error(`could not read ${what}`);
  return value;
};

/** What the repository pins, read from the files named in FILES. `read` gives the text of a file. */
export function readPins(read) {
  const rust = /channel\s*=\s*"([^"]+)"/.exec(read(FILES.rust))?.[1];
  const crate = /crypto-bigint\s*=\s*\{[^}]*version\s*=\s*"=?([^"]+)"/.exec(read(FILES.cargo))?.[1];
  const image = [...read(FILES.docker).matchAll(/^FROM node:(\d+)/gm)].map((m) => Number(m[1]));
  const nvmrc = /(\d+)/.exec(read(FILES.nvmrc))?.[1];
  return {
    rust: must(rust, `the Rust channel in ${FILES.rust}`),
    crate: must(crate, `the crypto-bigint version in ${FILES.cargo}`),
    nodeImage: must(image[0], `the node image in ${FILES.docker}`),
    nodeDev: nvmrc === undefined ? undefined : Number(nvmrc),
  };
}

/** The newest stable Rust version in the channel manifest. */
export const latestRust = (manifest) => /\[pkg\.rust\]\s*\nversion = "(\d+\.\d+\.\d+)/.exec(manifest)?.[1];

export function checkRust(pinned, latest) {
  const have = parseVersion(pinned);
  const want = parseVersion(latest ?? '');
  if (have === undefined) return { name: 'Rust toolchain', pinned, latest, behind: false, note: `"${pinned}" is not a version number (a channel such as "stable" is not pinned)` };
  if (want === undefined) throw new Error('could not read the latest Rust version');
  const minorsBehind = want[0] === have[0] ? want[1] - have[1] : Number.POSITIVE_INFINITY;
  const patchBehind = minorsBehind === 0 && want[2] > have[2];
  const behind = minorsBehind >= RUST_MINOR_LAG || patchBehind;
  const why = patchBehind ? 'a newer patch release of the same version exists (those are security or correctness fixes)' : `it is ${minorsBehind} releases behind (the limit is ${RUST_MINOR_LAG - 1})`;
  return {
    name: 'Rust toolchain',
    pinned,
    latest,
    behind,
    note: behind ? `${why}. Change \`${FILES.rust}\`, then rebuild the module on Linux x86_64 with \`scripts/build-srp-wasm.sh\` and commit the new bytes.` : 'current enough',
  };
}

export function checkCrate(pinned, latest, updatedAt) {
  const have = parseVersion(pinned);
  const want = parseVersion(latest ?? '');
  if (have === undefined || want === undefined) throw new Error(`could not compare crypto-bigint ${pinned} with ${latest}`);
  const behind = compareVersions(have, want) < 0;
  return {
    name: 'crypto-bigint (the SRP module)',
    pinned,
    latest,
    behind,
    note: behind
      ? `a newer release exists${updatedAt ? ` (updated ${updatedAt.slice(0, 10)})` : ''}. Read its changelog, bump \`${FILES.cargo}\` and \`Cargo.lock\`, rebuild with \`scripts/build-srp-wasm.sh\` and commit the new bytes. The module does constant-time arithmetic, so a release is worth reading even when nothing is broken.`
      : 'current',
  };
}

/** `schedule` is the Node release schedule: { "v22": { "end": "2027-04-30", "lts": "2024-10-29", ... }, ... }. */
export function checkNode(image, dev, schedule, today) {
  const entry = schedule[`v${image}`];
  if (entry === undefined || typeof entry.end !== 'string') throw new Error(`the Node release schedule has no end date for v${image}`);
  const days = Math.floor((Date.parse(entry.end) - today.getTime()) / 86_400_000);
  const behind = days <= NODE_EOL_WARNING_DAYS;
  const lts = Object.entries(schedule)
    .filter(([, v]) => typeof v.lts === 'string' && Date.parse(v.lts) <= today.getTime() && Date.parse(v.end) > today.getTime())
    .map(([name]) => Number(name.slice(1)))
    .sort((a, b) => b - a);
  const newest = lts[0];
  return {
    name: 'Node in the relay image',
    pinned: `${image}${dev === undefined ? '' : ` (development and CI use ${dev})`}`,
    latest: newest === undefined ? 'unknown' : `${newest} (the newest LTS)`,
    behind,
    note: behind
      ? `Node ${image} ends on ${entry.end}${days < 0 ? ' (already ended)' : ` (in ${days} days)`}. Choose the new major together with .nvmrc and \`engines\` (\`scripts/node-versions.test.ts\` keeps them in order), then update both FROM lines in \`${FILES.docker}\`.`
      : `Node ${image} is supported until ${entry.end}${newest !== undefined && newest > image ? `; a newer LTS (${newest}) is available, which is a decision, not a deadline` : ''}`,
  };
}

/** The Markdown of the issue, or of a short all-clear. */
export function render(results, today) {
  const behind = results.filter((r) => r.behind);
  const lines = [`Checked on ${today.toISOString().slice(0, 10)} by \`scripts/check-upstream-pins.mjs\`.`, ''];
  lines.push(behind.length === 0 ? 'Every pin is current.' : `${behind.length} of ${results.length} pins need a look.`, '');
  lines.push('| Pin | Ours | Upstream | |', '| --- | --- | --- | --- |');
  for (const r of results) lines.push(`| ${r.name} | ${r.pinned} | ${r.latest ?? '?'} | ${r.behind ? 'behind' : 'ok'} |`);
  for (const r of behind) lines.push('', `**${r.name}.** ${r.note}`);
  lines.push('', 'These pins are not updated by Dependabot on purpose (`.github/dependabot.yml`). This issue closes itself when nothing is behind.');
  return `${lines.join('\n')}\n`;
}

/** Runs every check. `read` reads a repository file and `get` fetches a URL as text. */
export async function check({ read, get, today = new Date() }) {
  const pins = readPins(read);
  const [rustManifest, crateJson, scheduleJson] = await Promise.all([get(SOURCES.rust), get(SOURCES.crate), get(SOURCES.node)]);
  const crate = JSON.parse(crateJson).crate ?? {};
  const results = [
    checkRust(pins.rust, latestRust(rustManifest)),
    checkCrate(pins.crate, crate.max_stable_version ?? crate.max_version, crate.updated_at),
    checkNode(pins.nodeImage, pins.nodeDev, JSON.parse(scheduleJson), today),
  ];
  return { results, markdown: render(results, today), behind: results.some((r) => r.behind) };
}

async function main() {
  const out = process.argv.includes('--markdown') ? process.argv[process.argv.indexOf('--markdown') + 1] : undefined;
  const token = process.env['GITHUB_TOKEN'];
  const get = async (url) => {
    const response = await fetch(url, { headers: { 'user-agent': 'cashfold-upstream-pins (+https://github.com/cashfold/cashfold)', ...(token && url.includes('github') ? { authorization: `Bearer ${token}` } : {}) } });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.text();
  };
  const result = await check({ read: (file) => readFileSync(file, 'utf8'), get });
  process.stdout.write(result.markdown);
  if (out !== undefined) writeFileSync(out, result.markdown);
  process.exit(result.behind ? 3 : 0);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Could not check the upstream pins: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
