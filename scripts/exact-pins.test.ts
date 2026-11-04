import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every dependency is pinned to one exact version (.npmrc sets save-exact, constitution VIII), so an update is always a reviewed change. That
// setting only affects `pnpm add`: a hand edit or a copy from another project can still bring in `^1.2.3`, which would let a later install
// pick a version nobody looked at. This test makes the rule true, not just usual.
//
// Not checked on purpose: `peerDependencies` (a range is how a package says what it works with) and the root `pnpm.overrides` (a security
// override is written as a range, such as ">=4.7.10", to force a floor).

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const KINDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

const manifests = execFileSync('git', ['ls-files', '-z', '--', 'package.json', '**/package.json'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => file !== '' && !file.includes('node_modules/'));

/** The problems in one dependency table: ranges, tags such as "latest", and anything else that is not one exact version. */
export function inexact(table: Record<string, string> | undefined): string[] {
  return Object.entries(table ?? {})
    .filter(([, spec]) => !EXACT.test(spec) && !spec.startsWith('workspace:'))
    .map(([name, spec]) => `${name}@${spec}`);
}

describe('exact dependency versions', () => {
  it('finds the package manifests of the workspace', () => {
    expect(manifests).toContain('package.json');
    expect(manifests.length).toBeGreaterThan(5);
  });

  it.each(manifests)('%s pins every dependency to one exact version', (file) => {
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as Partial<Record<(typeof KINDS)[number], Record<string, string>>>;
    for (const kind of KINDS) expect(inexact(manifest[kind]), `${file} ${kind}: write one exact version, such as 1.2.3`).toEqual([]);
  });

  describe('the check itself', () => {
    it('accepts exact versions, pre-releases and workspace links', () => {
      expect(inexact({ a: '1.2.3', b: '4.0.0-rc.1', c: '2.0.0-beta.2+build.5', d: 'workspace:*' })).toEqual([]);
    });

    it('rejects ranges, tags and wildcards', () => {
      expect(inexact({ a: '^1.2.3', b: '~1.2.3', c: '>=1', d: 'latest', e: '1.x', f: '*', g: '1.2' })).toEqual(['a@^1.2.3', 'b@~1.2.3', 'c@>=1', 'd@latest', 'e@1.x', 'f@*', 'g@1.2']);
    });
  });
});
