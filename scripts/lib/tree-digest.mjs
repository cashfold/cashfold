// The digest of a directory tree, as the reproducible-build check and the release publish it: the SHA-256 of every file, listed by path
// in sorted order, and the SHA-256 of that list. One implementation, so the desktop package can check that the web export it embeds is
// the one the web release published (spec 003, R-D-09).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** @returns {Record<string, string>} path (forward slashes, relative to dir) → SHA-256 of the file */
export const hashTree = (dir) =>
  Object.fromEntries([...walk(dir)].map((p) => [relative(dir, p).split('\\').join('/'), createHash('sha256').update(readFileSync(p)).digest('hex')]));

/** The SHA256SUMS text for a set of file hashes: "<hash>  <path>" per line, sorted by path. */
export const sumsOf = (hashes) =>
  Object.keys(hashes)
    .sort()
    .map((name) => `${hashes[name]}  ${name}`)
    .join('\n') + '\n';

/** The digest of the whole tree. */
export const digestOfSums = (sums) => createHash('sha256').update(sums).digest('hex');

export const treeDigest = (dir) => digestOfSums(sumsOf(hashTree(dir)));
