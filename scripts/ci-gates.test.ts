import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The gates of the constitution's Quality Gates (T007, T009, T010) must run in the one CI job that `main` requires, and the release must
// not skip them. The repository can check its own workflow and the protection script; that GitHub applies them is a setting a maintainer
// makes with scripts/apply-branch-protection.sh (docs/repo-settings.md).

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');

describe('quality gates', () => {
  it('CI runs every gate in the `verify` job', () => {
    expect(ci).toMatch(/^  verify:/m);
    for (const gate of [
      'pnpm typecheck', 'pnpm lint', 'pnpm vitest run --coverage', 'pnpm build', 'pnpm check:bundle', 'pnpm check:licenses', 'pnpm check:no-float', 'pnpm check:sqlite3mc',
      'pnpm audit --audit-level=high', 'pnpm test:e2e', 'test:integration', 'gen-third-party-notices.mjs --check', 'build-verify.mjs', 'gen-migrations.mjs', 'gen-protocol-docs.mjs',
    ]) expect(ci, gate).toContain(gate);
  });

  it('there is exactly one job, so the one required check covers all of it', () => {
    expect([...ci.slice(ci.indexOf('\njobs:')).matchAll(/^  ([a-z-]+):\s*$/gm)].map((m) => m[1])).toEqual(['verify']);
  });

  it('main requires `verify` and reviews of the sensitive paths', () => {
    expect(read('scripts/apply-branch-protection.sh')).toContain('"contexts": ["verify"]');
    expect(read('docs/repo-settings.md')).toContain('Required status check `verify`');
    expect(read('.github/CODEOWNERS')).toMatch(/packages\/crypto\//);
  });

  it('the release repeats the checks, proves the build is reproducible, and waits for the external review', () => {
    for (const step of ['check-review-gate.mjs', 'pnpm vitest run', 'pnpm check:licenses', 'build-verify.mjs', 'cdxgen', 'attest-build-provenance']) expect(release, step).toContain(step);
    expect(release.indexOf('check-review-gate.mjs')).toBeLessThan(release.indexOf('Publish'));
  });
});
