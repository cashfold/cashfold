import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { render, summarize } from './summarize-flaky.mjs';

// The flaky-test check (.github/workflows/flaky.yml) repeats the specs a pull request changed and reads Playwright's JSON report with this.

type Status = 'passed' | 'failed' | 'timedOut' | 'skipped';
const repeat = (statuses: Status[], project = 'chromium') => statuses.map(() => project).map((projectName, i) => ({ projectName, results: [{ status: statuses[i]! }] }));
const report = (specs: Array<{ file: string; title: string; tests: ReturnType<typeof repeat> }>) => ({ suites: [{ file: 'a', specs: [], suites: [{ file: 'a', specs }] }] });

describe('summarize', () => {
  it('calls a test that passes every repeat stable', () => {
    const { rows, flaky, failing } = summarize(report([{ file: 'e2e/a.spec.ts', title: 'adds', tests: repeat(['passed', 'passed', 'passed']) }]));
    expect(rows).toEqual([{ file: 'e2e/a.spec.ts', title: 'adds', project: 'chromium', passed: 3, failed: 0, verdict: 'stable' }]);
    expect(flaky).toEqual([]);
    expect(failing).toEqual([]);
  });

  it('calls a test that passes and fails flaky', () => {
    const { flaky, failing } = summarize(report([{ file: 'e2e/a.spec.ts', title: 'races', tests: repeat(['passed', 'failed', 'passed', 'passed', 'timedOut']) }]));
    expect(flaky.map((r) => [r.title, r.passed, r.failed])).toEqual([['races', 3, 2]]);
    expect(failing).toEqual([]);
  });

  it('calls a test that fails every repeat failing, not flaky', () => {
    const { flaky, failing } = summarize(report([{ file: 'e2e/a.spec.ts', title: 'broken', tests: repeat(['failed', 'timedOut']) }]));
    expect(flaky).toEqual([]);
    expect(failing.map((r) => r.title)).toEqual(['broken']);
  });

  it('keeps the same title in two projects apart, and ignores skipped repeats', () => {
    const { rows } = summarize(report([
      { file: 'e2e/a.spec.ts', title: 'same', tests: [...repeat(['passed', 'passed'], 'chromium'), ...repeat(['failed', 'failed'], 'firefox')] },
      { file: 'e2e/b.spec.ts', title: 'skipped here', tests: repeat(['skipped', 'skipped']) },
    ]));
    expect(rows.map((r) => [r.title, r.project, r.verdict])).toEqual([['same', 'chromium', 'stable'], ['same', 'firefox', 'failing']]);
  });

  it('reads the final attempt of a repeat, so a retried pass counts as a pass', () => {
    const retried = { projectName: 'chromium', results: [{ status: 'failed' }, { status: 'passed' }] };
    const { rows } = summarize({ suites: [{ specs: [{ file: 'e2e/a.spec.ts', title: 't', tests: [retried] }] }] });
    expect(rows[0]).toMatchObject({ passed: 1, failed: 0, verdict: 'stable' });
  });

  it('walks nested suites', () => {
    const nested = { suites: [{ file: 'e2e/a.spec.ts', suites: [{ suites: [{ specs: [{ title: 'deep', tests: repeat(['passed']) }] }] }] }] };
    expect(summarize(nested).rows.map((r) => [r.file, r.title])).toEqual([['e2e/a.spec.ts', 'deep']]);
  });
});

describe('render', () => {
  it('lists failing and flaky tests before stable ones, and escapes pipes', () => {
    const md = render(summarize(report([
      { file: 'e2e/a.spec.ts', title: 'fine', tests: repeat(['passed', 'passed']) },
      { file: 'e2e/a.spec.ts', title: 'a | b', tests: repeat(['passed', 'failed']) },
    ])));
    expect(md).toContain('1 flaky and 0 failing of 2 test(s).');
    expect(md.indexOf('a \\| b')).toBeLessThan(md.indexOf('fine'));
  });

  it('says so when nothing ran', () => {
    expect(render(summarize({ suites: [] }))).toContain('No test ran');
  });
});

describe('the command', () => {
  const run = (json: unknown) => {
    const path = join(mkdtempSync(join(tmpdir(), 'cashfold-flaky-')), 'report.json');
    writeFileSync(path, JSON.stringify(json));
    return spawnSync(process.execPath, [new URL('./summarize-flaky.mjs', import.meta.url).pathname, path], { encoding: 'utf8' });
  };

  it('exits 0 when every repeat passed', () => {
    expect(run(report([{ file: 'e2e/a.spec.ts', title: 't', tests: repeat(['passed', 'passed']) }])).status).toBe(0);
  });

  it('exits 1 for a flaky test and prints it', () => {
    const result = run(report([{ file: 'e2e/a.spec.ts', title: 'races', tests: repeat(['passed', 'failed']) }]));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('races');
  });

  it('exits 1 when no test ran, so an empty or wrong spec list cannot pass', () => {
    expect(run({ suites: [] }).status).toBe(1);
  });
});

describe('the workflow', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/flaky.yml', import.meta.url), 'utf8')) as {
    on: { pull_request?: { paths?: string[] } };
    permissions: Record<string, string>;
    jobs: Record<string, { steps: Array<{ env?: Record<string, string>; run?: string }> }>;
  };
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);

  it('watches the specs, reads the repository and nothing more, and never runs with the base repository secrets (a pull_request, not pull_request_target)', () => {
    expect(Object.keys(workflow.on)).toEqual(['pull_request']);
    expect(workflow.on.pull_request?.paths).toEqual(['e2e/*.spec.ts']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('gives Playwright an absolute report path: a relative one lands next to the config (e2e/), where the summary step would not look', () => {
    const name = steps.map((step) => step.env?.['PLAYWRIGHT_JSON_OUTPUT_NAME']).find((value) => value !== undefined);
    expect(name).toMatch(/^\$\{\{ github\.workspace \}\}\//);
    const run = steps.map((step) => step.run ?? '').join('\n');
    expect(run).toContain('--retries=0');
    expect(run).toContain('--repeat-each');
    expect(run).toContain('summarize-flaky.mjs flaky-report.json');
  });
});
