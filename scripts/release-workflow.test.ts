import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

// Static checks of the workflows that make a release (specs/003, contract release-pipeline, P-3, P-4, P-5, P-9, P-11): who may write, what
// is pinned, which environment a job may use, and the order in which things must have succeeded. They cannot prove GitHub applies them;
// they stop the repository from drifting away from them.

const root = new URL('../', import.meta.url).pathname;
const dir = join(root, '.github/workflows');
interface Job { needs?: string | string[]; if?: string; environment?: unknown; permissions?: Record<string, string>; uses?: string; with?: Record<string, unknown>; steps?: Array<{ uses?: string; run?: string; name?: string }>; strategy?: unknown; 'runs-on'?: string }
interface Workflow { on: unknown; permissions?: Record<string, string>; concurrency?: { group: string; 'cancel-in-progress': boolean }; jobs: Record<string, Job> }
const load = (name: string): Workflow => parse(readFileSync(join(dir, name), 'utf8')) as Workflow;
const text = (name: string): string => readFileSync(join(dir, name), 'utf8');
const needs = (job: Job): string[] => (job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs]);

const RELEASE_WORKFLOWS = ['release.yml', 'release-please.yml', 'desktop-build.yml', 'desktop-smoke.yml'];

describe('every action is pinned to a commit', () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
    it(`${file}`, () => {
      const uses = [...text(file).matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]!).filter((u) => !u.startsWith('./'));
      for (const action of uses) expect(action, `${file}: ${action}`).toMatch(/@[0-9a-f]{40}$/);
    });
  }
});

describe('what each workflow may write', () => {
  for (const file of RELEASE_WORKFLOWS) {
    it(`${file} reads the repository and nothing more by default`, () => {
      expect(load(file).permissions).toEqual({ contents: 'read' });
    });
  }

  it('only the publish job of release.yml may write the release, make attestations, and use the OIDC token', () => {
    const jobs = load('release.yml').jobs;
    expect(jobs['publish']?.permissions).toEqual({ contents: 'write', 'id-token': 'write', attestations: 'write' });
    for (const [name, job] of Object.entries(jobs)) {
      if (name === 'publish') continue;
      const granted = job.permissions ?? {};
      expect(granted['contents'] ?? 'read', name).toBe('read');
      expect(granted['id-token'], name).toBeUndefined();
      expect(granted['attestations'], name).toBeUndefined();
    }
  });

  it('the failure notice may open an issue and nothing else', () => {
    expect(load('release.yml').jobs['notify']?.permissions).toEqual({ contents: 'read', issues: 'write' });
  });
});

describe('the order of the release', () => {
  const jobs = load('release.yml').jobs;

  it('is only ever run on a tag (or re-run on one), once at a time, and never cancelled half way', () => {
    const on = load('release.yml').on as { push?: { tags?: string[] }; workflow_dispatch?: unknown };
    expect(on.push?.tags).toEqual(['v*']);
    expect(on).toHaveProperty('workflow_dispatch');
    expect(load('release.yml').concurrency?.['cancel-in-progress']).toBe(false);
    expect(load('release.yml').concurrency?.group).toContain('release');
  });

  it('builds nothing after a red gate: the web build and the desktop build need the gates (P-5)', () => {
    expect(needs(jobs['web']!)).toContain('gates');
    expect(needs(jobs['desktop']!)).toContain('gates');
  });

  it('publishes only when every gate, the web build and every platform succeeded (P-3)', () => {
    const publish = jobs['publish']!;
    expect(needs(publish).sort()).toEqual(['desktop', 'gates', 'web']);
    expect(publish.if ?? 'success()').toMatch(/success\(\)/);
  });

  it('publishes in the environment that holds the update-signing key, and that is the only job that does', () => {
    expect(jobs['publish']?.environment).toBe('release');
    for (const [name, job] of Object.entries(jobs)) if (name !== 'publish') expect(job.environment, name).toBeUndefined();
  });

  it('opens an issue when anything fails', () => {
    expect(jobs['notify']?.if).toMatch(/failure\(\)/);
    expect(needs(jobs['notify']!).sort()).toEqual(['desktop', 'gates', 'publish', 'web']);
  });

  it('checks that the run is for a version tag of the commit it builds, and that package.json agrees with the tag', () => {
    const gates = JSON.stringify(jobs['gates']);
    expect(gates).toContain('ref_type');
    expect(gates).toContain('check-release-tag');
  });
});

describe('which environment a job may use', () => {
  it('the smoke test uses none', () => {
    for (const [name, job] of Object.entries(load('desktop-smoke.yml').jobs)) expect(job.environment, name).toBeUndefined();
  });

  it('the build uses the release environment only to sign, and never otherwise (a dispatch or a pull request cannot reach a secret)', () => {
    const build = load('desktop-build.yml').jobs['build']!;
    if (build.environment !== undefined) expect(build.environment).toBe("${{ inputs.sign && 'release' || '' }}");
  });

  it('the release proposal uses the environment without reviewers, never the signing one', () => {
    const jobs = load('release-please.yml').jobs;
    for (const [name, job] of Object.entries(jobs)) expect(job.environment, name).toBe('release-proposal');
  });

  it('the release proposal runs on pushes to main only', () => {
    const on = load('release-please.yml').on as { push?: { branches?: string[] } };
    expect(on.push?.branches).toEqual(['main']);
  });
});

describe('secrets', () => {
  it('are never written on a command line', () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
      for (const match of text(file).matchAll(/^\s*run:\s*[|>]?\s*([\s\S]*?)(?=^\s*(?:-\s|\w[\w-]*:\s))/gm)) {
        expect(match[1], `${file}: a run step uses a secret directly`).not.toMatch(/\$\{\{\s*secrets\./);
      }
    }
  });

  it('are handed to steps through env, by name', () => {
    expect(text('release.yml')).toMatch(/UPDATE_SIGNING_KEY:\s*\$\{\{\s*secrets\.UPDATE_SIGNING_KEY\s*\}\}/);
  });
});

describe('the build workflow', () => {
  it('builds on the three systems and uploads artifacts, and never creates or edits a release itself', () => {
    const t = text('desktop-build.yml');
    for (const os of ['windows-latest', 'macos-latest', 'ubuntu-latest']) expect(t).toContain(os);
    expect(t).toContain('upload-artifact');
    expect(t).not.toMatch(/gh release|softprops|create-release|action-gh-release/);
  });

  it('has no step that continues after a failure when it is signing', () => {
    expect(text('desktop-build.yml')).not.toMatch(/continue-on-error:\s*true/);
  });
});


describe('signing', () => {
  const text = (name: string): string => readFileSync(join(dir, name), 'utf8');

  it('checks that the credentials are complete before anything is signed, in the job that signs', () => {
    const build = text('desktop-build.yml');
    expect(build).toContain('check-signing-env.mjs');
    expect(build.indexOf('check-signing-env.mjs')).toBeLessThan(build.indexOf('Build the installers'));
  });

  it('gives the signing credentials to the job only when it signs, from the release environment', () => {
    const build = load('desktop-build.yml').jobs['build']!;
    expect(build.environment).toBe("${{ inputs.sign && 'release' || '' }}");
    const steps = JSON.stringify(build.steps);
    for (const name of ['APPLE_CERT_P12', 'APPLE_CERT_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) expect(steps, name).toContain(`secrets.${name}`);
  });

  it('says in its summary whether the installers are signed', () => {
    expect(text('desktop-build.yml')).toMatch(/signed|UNSIGNED/);
    expect(text('desktop-build.yml')).toContain('GITHUB_STEP_SUMMARY');
  });

  it('is switched on by a repository variable, so that enabling signing is a setting and not a code change', () => {
    const release = text('release.yml');
    expect(release).toMatch(/sign:\s*\$\{\{\s*vars\.RELEASE_SIGN\s*==\s*'true'\s*\}\}/);
    expect(release).toMatch(/RELEASE_SIGNED:\s*\$\{\{\s*vars\.RELEASE_SIGN\s*==\s*'true'/);
  });

  it('can echo a canary secret, from outside the release environment, to prove that logs are masked', () => {
    const build = text('desktop-build.yml');
    expect(build).toContain('LOG_MASKING_CANARY');
  });
});
