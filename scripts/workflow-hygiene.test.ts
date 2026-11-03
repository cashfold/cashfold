import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

// Rules for every workflow that are cheap to check here and costly to find out later: what a job leaves behind, and what reaches a shell. They
// overlap with zizmor (.github/workflows/zizmor.yml) on purpose: this runs in `pnpm vitest` on a laptop, before a push.

const dir = new URL('../.github/workflows/', import.meta.url).pathname;
interface Step { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> }
interface Job { permissions?: Record<string, string>; steps?: Step[] }
interface Workflow { on: unknown; permissions?: Record<string, string>; concurrency?: unknown; jobs: Record<string, Job> }

const files = readdirSync(dir).filter((f) => f.endsWith('.yml'));
const load = (file: string): Workflow => parse(readFileSync(join(dir, file), 'utf8')) as Workflow;
const stepsOf = (workflow: Workflow): Step[] => Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);

/** Contexts whose text the author of a pull request, an issue or a comment controls. In a script they become code. */
export const UNTRUSTED = [
  /github\.event\.pull_request\.(title|body|head\.ref|head\.label|head\.repo\.[a-z_.]*)/,
  /github\.event\.(issue|comment|review|review_comment|discussion)\.(title|body)/,
  /github\.event\.(head_commit|commits[^}]*)\.(message|author\.(name|email))/,
  /github\.head_ref/,
  /github\.event\.workflow_run\.(head_branch|head_commit\.message|display_title)/,
];

/** Which untrusted contexts a script uses (an empty list is good). */
export const injectionsIn = (script: string): string[] => UNTRUSTED.flatMap((pattern) => script.match(new RegExp(`\\$\\{\\{[^}]*${pattern.source}[^}]*\\}\\}`, 'g')) ?? []);

describe('workflows', () => {
  it('finds the workflows', () => {
    expect(files).toContain('ci.yml');
    expect(files).toContain('pr-title.yml');
  });

  describe.each(files)('%s', (file) => {
    const workflow = load(file);

    it('leaves no git credentials in a checkout (persist-credentials: false)', () => {
      for (const step of stepsOf(workflow).filter((s) => s.uses?.startsWith('actions/checkout@'))) {
        expect(step.with?.['persist-credentials'], `${file}: a checkout keeps the token in .git/config for the rest of the job`).toBe(false);
      }
    });

    it('never puts the text of a pull request, issue or comment into a script', () => {
      for (const step of stepsOf(workflow)) expect(injectionsIn(step.run ?? ''), `${file}: pass it through env: and read "$NAME" in the script`).toEqual([]);
    });

    it('asks for no more than read access to the repository by default', () => {
      expect(workflow.permissions?.['contents'] ?? 'read', 'workflow-level contents').toBe('read');
      for (const [key, value] of Object.entries(workflow.permissions ?? {})) {
        if (key !== 'contents') expect(value, `${file}: workflow-level ${key} is write: grant it to the one job that needs it`).not.toBe('write');
      }
    });
  });

  describe('the check itself', () => {
    it('finds the title of a pull request in a script', () => {
      expect(injectionsIn('echo "${{ github.event.pull_request.title }}"')).toHaveLength(1);
      expect(injectionsIn('git checkout ${{ github.head_ref }}')).toHaveLength(1);
      expect(injectionsIn('echo ${{ github.event.comment.body }} ${{ github.event.issue.title }}')).toHaveLength(2);
    });

    it('lets safe contexts through', () => {
      expect(injectionsIn('echo ${{ github.sha }} ${{ matrix.browser }} ${{ github.workspace }} ${{ github.run_id }}')).toEqual([]);
    });
  });
});

describe('pr-title.yml', () => {
  const workflow = load('pr-title.yml');
  const on = workflow.on as { pull_request?: { types?: string[]; paths?: string[] } };

  it('runs when a title is edited, as well as when a pull request opens or changes', () => {
    expect(on.pull_request?.types).toEqual(expect.arrayContaining(['opened', 'edited', 'synchronize', 'reopened']));
  });

  it('has no path filter, because a required check that does not run waits forever', () => {
    expect(on.pull_request?.paths).toBeUndefined();
  });

  it('is a job named pr-title, which is the name branch protection requires', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['pr-title']);
  });

  it('hands the title to commitlint through the environment and never writes it into the script', () => {
    const step = workflow.jobs['pr-title']!.steps!.find((s) => (s.run ?? '').includes('commitlint'))!;
    expect(step.env?.['TITLE']).toBe('${{ github.event.pull_request.title }}');
    expect(step.run).toContain('"$TITLE"');
    expect(step.run).not.toContain('${{');
  });
});

describe('the release pipeline', () => {
  it('restores no dependency cache in release.yml: a poisoned cache could reach a signed release, and a release is rare enough for a cold install', () => {
    for (const step of stepsOf(load('release.yml')).filter((s) => s.uses?.startsWith('actions/setup-node@'))) {
      expect(step.with?.['cache'], 'release.yml: remove `cache:` from setup-node').toBeUndefined();
      expect(step.with?.['package-manager-cache'], 'release.yml: set package-manager-cache: false, newer setup-node versions cache by themselves').toBe(false);
    }
  });

  it('gives every GitHub App token the permissions it needs by name, instead of every permission the installation has', () => {
    for (const file of files) {
      for (const step of stepsOf(load(file)).filter((s) => s.uses?.startsWith('actions/create-github-app-token@'))) {
        const named = Object.keys(step.with ?? {}).filter((key) => key.startsWith('permission-'));
        expect(named.length, `${file}: add permission-contents, permission-pull-requests, ... to the app token`).toBeGreaterThan(0);
      }
    }
  });

  it('release-please asks for the three permissions docs/desktop.md says its App has, and no more', () => {
    const step = stepsOf(load('release-please.yml')).find((s) => s.uses?.startsWith('actions/create-github-app-token@'))!;
    const named = Object.fromEntries(Object.entries(step.with ?? {}).filter(([key]) => key.startsWith('permission-')));
    expect(named).toEqual({ 'permission-contents': 'write', 'permission-pull-requests': 'write', 'permission-issues': 'write' });
  });
});

describe('the added checks', () => {
  const permissionsOf = (file: string) => Object.values(load(file).jobs).map((job) => job.permissions);

  it('zizmor, dependency review and pr-title ask for nothing beyond the default read access', () => {
    for (const file of ['zizmor.yml', 'dependency-review.yml', 'pr-title.yml']) expect(permissionsOf(file), file).toEqual([undefined]);
  });

  it('CodeQL may write security events (its results) in the analysis job, and only that', () => {
    expect(load('codeql.yml').permissions).toEqual({ contents: 'read' });
    expect(permissionsOf('codeql.yml')).toEqual([{ contents: 'read', 'security-events': 'write' }]);
  });

  it('zizmor does not need the Code Scanning upload, so it asks for no security-events permission', () => {
    const step = load('zizmor.yml').jobs['zizmor']!.steps!.find((s) => s.uses?.startsWith('zizmorcore/zizmor-action@'))!;
    expect(step.with?.['advanced-security']).toBe(false);
  });
});

describe('the title rules (commitlint.pr-title.config.js)', () => {
  /** What the workflow does with a title: pipe it into commitlint with this config. */
  const check = (title: string) => {
    const run = spawnSync('pnpm', ['exec', 'commitlint', '--config', 'commitlint.pr-title.config.js'], { input: `${title}\n`, encoding: 'utf8', cwd: new URL('../', import.meta.url).pathname });
    return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` };
  };

  it('is the config the workflow uses', () => {
    const step = load('pr-title.yml').jobs['pr-title']!.steps!.find((s) => (s.run ?? '').includes('commitlint'))!;
    expect(step.run).toContain('--config commitlint.pr-title.config.js');
  });

  it.each([
    // what the bots write, including a title past 100 characters
    'chore(deps): bump postcss from 8.5.30 to 8.5.32 in /apps/web in the tailwind group across 1 directory',
    'chore(deps-dev): bump @aztec/sqlite3mc-wasm from 5.2.1 to 5.3.0 in /apps/web',
    'ci(deps): bump actions/checkout from 4.4.0 to 7.0.1',
    'chore(main): release 0.14.1',
    // what people write, with the number GitHub adds to a squash commit
    'feat(web): show only the group total on the accounts page and rename Rename group to Edit group (#71)',
    'fix(web): keep the amount and note when switching between expense, income and transfer (#73)',
    'feat!: drop the old backup format',
  ])('accepts %s', (title) => {
    expect(check(title).ok, check(title).output).toBe(true);
  });

  it.each([
    ['no type', 'Update stuff'],
    ['a capital letter at the start of the subject', 'fix: Capitalised subject'],
    ['no colon', 'fix the thing'],
    ['an unknown type', 'update: change the thing'],
    ['an empty subject', 'fix: '],
  ])('rejects %s', (_why, title) => {
    expect(check(title).ok).toBe(false);
  });
});
