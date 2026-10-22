// The first gate of the release workflow: it only builds a version tag, the commit the tag names, with the version in package.json that the
// tag says. The release proposal merge writes the version into package.json and then makes the tag, so on a proper release all three agree;
// anything else (a hand-made tag, a branch, a re-run on the wrong ref) stops here, before anything is built or published.
//
//   node scripts/check-release-tag.mjs      (reads GITHUB_REF_TYPE, GITHUB_REF_NAME and the repository)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** @returns {string[]} the problems, empty when the run may go on */
export function checkReleaseTag({ refType, refName, packageVersion, head, tagCommit }) {
  const problems = [];
  if (refType !== 'tag') problems.push(`this run is on a ${refType} (${refName}), not a tag: a release is made only from a version tag`);
  else if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(refName)) problems.push(`"${refName}" is not a version tag of the form vMAJOR.MINOR.PATCH`);
  else if (packageVersion !== refName.slice(1)) problems.push(`package.json says ${packageVersion} but the tag says ${refName.slice(1)}: the release proposal has to be merged first, and the tag must come from it`);
  if (head !== tagCommit) problems.push(`the commit checked out (${head}) is not the commit the tag names (${tagCommit})`);
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const refName = process.env.GITHUB_REF_NAME ?? '';
  const problems = checkReleaseTag({
    refType: process.env.GITHUB_REF_TYPE ?? 'unknown',
    refName,
    packageVersion: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
    head: git('rev-parse', 'HEAD'),
    tagCommit: (() => {
      try {
        return git('rev-parse', `${refName}^{commit}`);
      } catch {
        return 'unknown';
      }
    })(),
  });
  if (problems.length > 0) {
    console.error('This is not a release that may be built:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`release tag ${refName}: ok`);
}
