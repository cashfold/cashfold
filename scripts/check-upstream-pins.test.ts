import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { FILES, NODE_EOL_WARNING_DAYS, SOURCES, check, checkCrate, checkNode, checkRust, compareVersions, latestRust, parseVersion, readPins, render } from './check-upstream-pins.mjs';

// The weekly check of the pins Dependabot cannot update (.github/workflows/upstream-pins.yml): the Rust toolchain and crypto-bigint behind the SRP
// module, and the Node major of the relay image. The comparison is tested here with made-up upstream answers; nothing in this file uses the network.

const repoFile = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const TODAY = new Date('2026-11-03T12:00:00Z');
const day = (offset: number): string => new Date(TODAY.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

describe('versions', () => {
  it('reads three numbers and ignores a leading v and anything after', () => {
    expect(parseVersion('1.99.1')).toEqual([1, 99, 1]);
    expect(parseVersion('v26.1.0')).toEqual([26, 1, 0]);
    expect(parseVersion('0.7.10 (2026-10-26)')).toEqual([0, 7, 10]);
  });

  it('does not read a channel or a half version', () => {
    expect(parseVersion('stable')).toBeUndefined();
    expect(parseVersion('1.99')).toBeUndefined();
  });

  it('compares numerically, not as text', () => {
    expect(compareVersions([0, 7, 5], [0, 7, 10])).toBeLessThan(0);
    expect(compareVersions([1, 100, 0], [1, 99, 9])).toBeGreaterThan(0);
    expect(compareVersions([1, 2, 3], [1, 2, 3])).toBe(0);
  });
});

describe('what the repository pins', () => {
  const read = repoFile;

  it('is found in the real files', () => {
    const pins = readPins(read);
    expect(pins.rust).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pins.crate).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pins.nodeImage).toBeGreaterThanOrEqual(22);
    expect(pins.nodeDev).toBeGreaterThanOrEqual(pins.nodeImage);
  });

  it('stops with a clear message when a file no longer says what it did', () => {
    const empty = (file: string) => (file === FILES.cargo ? 'name = "x"' : read(file));
    expect(() => readPins(empty)).toThrow(/crypto-bigint version/);
    const noImage = (file: string) => (file === FILES.docker ? 'FROM scratch' : read(file));
    expect(() => readPins(noImage)).toThrow(/node image/);
  });
});

describe('Rust', () => {
  const manifest = '[date]\n"2026-10-22"\n\n[pkg.cargo]\nversion = "1.98.0 (aaa 2026-09-01)"\n\n[pkg.rust]\nversion = "1.99.1 (abc123 2026-10-22)"\n';

  it('reads the stable version from the channel manifest, not another package in it', () => {
    expect(latestRust(manifest)).toBe('1.99.1');
  });

  it('is current when equal, or one release behind', () => {
    expect(checkRust('1.99.1', '1.99.1').behind).toBe(false);
    expect(checkRust('1.98.0', '1.99.1').behind).toBe(false);
  });

  it('is reported two releases behind, which is about twelve weeks', () => {
    const result = checkRust('1.97.0', '1.99.1');
    expect(result.behind).toBe(true);
    expect(result.note).toContain('2 releases behind');
    expect(result.note).toContain('scripts/build-srp-wasm.sh');
  });

  it('is reported when a patch release of the same version exists, because those are fixes', () => {
    const result = checkRust('1.99.0', '1.99.1');
    expect(result.behind).toBe(true);
    expect(result.note).toContain('patch release');
  });

  it('does not judge a channel name', () => {
    expect(checkRust('stable', '1.99.1').behind).toBe(false);
  });

  it('fails loudly when the latest version cannot be read', () => {
    expect(() => checkRust('1.99.1', undefined)).toThrow();
  });
});

describe('crypto-bigint', () => {
  it('is current when equal', () => {
    expect(checkCrate('0.7.10', '0.7.10', undefined).behind).toBe(false);
  });

  it('is reported for any newer release, with the date and what to do', () => {
    const result = checkCrate('0.7.5', '0.7.10', '2026-10-26T08:00:00Z');
    expect(result.behind).toBe(true);
    expect(result.note).toContain('2026-10-26');
    expect(result.note).toContain('Cargo.lock');
  });

  it('is not reported when ahead of the newest stable (a pre-release was chosen on purpose)', () => {
    expect(checkCrate('0.8.0', '0.7.10', undefined).behind).toBe(false);
  });
});

describe('Node', () => {
  const schedule = {
    v20: { lts: day(-900), end: day(-30) },
    v22: { lts: day(-600), end: day(200) },
    v24: { lts: day(-200), end: day(500) },
    v26: { lts: day(-10), end: day(900) },
    v27: { start: day(60) },
  };

  it('is current while its end of life is further away than the warning', () => {
    const result = checkNode(22, 26, schedule, TODAY);
    expect(result.behind).toBe(false);
    expect(result.latest).toBe('26 (the newest LTS)');
    expect(result.note).toContain('a decision, not a deadline');
  });

  it(`is reported ${NODE_EOL_WARNING_DAYS} days before the end of life`, () => {
    const result = checkNode(22, 26, { ...schedule, v22: { lts: day(-600), end: day(NODE_EOL_WARNING_DAYS - 1) } }, TODAY);
    expect(result.behind).toBe(true);
    expect(result.note).toContain('scripts/node-versions.test.ts');
  });

  it('is reported when the end of life has passed', () => {
    const result = checkNode(20, 26, schedule, TODAY);
    expect(result.behind).toBe(true);
    expect(result.note).toContain('already ended');
  });

  it('does not count a version that is not yet LTS or has ended as the newest LTS', () => {
    expect(checkNode(26, 26, schedule, TODAY).latest).toBe('26 (the newest LTS)');
    expect(checkNode(24, 26, { ...schedule, v26: { start: day(-10) } }, TODAY).latest).toBe('24 (the newest LTS)');
  });

  it('fails loudly for a version the schedule does not know', () => {
    expect(() => checkNode(21, 26, schedule, TODAY)).toThrow(/v21/);
  });
});

describe('the report', () => {
  const ok = { name: 'A', pinned: '1', latest: '1', behind: false, note: 'fine' };
  const late = { name: 'B', pinned: '1', latest: '2', behind: true, note: 'Do this.' };

  it('says everything is current when it is', () => {
    expect(render([ok], TODAY)).toContain('Every pin is current.');
  });

  it('lists every pin and explains only those that are behind', () => {
    const text = render([ok, late], TODAY);
    expect(text).toContain('1 of 2 pins need a look.');
    expect(text).toContain('| B | 1 | 2 | behind |');
    expect(text).toContain('**B.** Do this.');
    expect(text).not.toContain('**A.**');
  });
});

describe('the whole check', () => {
  const answers: Record<string, string> = {
    [SOURCES.rust]: '[pkg.rust]\nversion = "1.99.1 (abc 2026-10-22)"\n',
    [SOURCES.crate]: JSON.stringify({ crate: { max_stable_version: '0.7.10', updated_at: '2026-10-26T08:00:00Z' } }),
    [SOURCES.node]: JSON.stringify({ v22: { lts: '2024-10-29', end: '2027-04-30' }, v26: { lts: '2026-10-28', end: '2029-04-30' } }),
  };
  const get = async (url: string) => answers[url] ?? Promise.reject(new Error(`unexpected ${url}`));

  it('runs the three checks against the real files and the given answers', async () => {
    const result = await check({ read: repoFile, get, today: TODAY });
    expect(result.results.map((r: { name: string }) => r.name)).toEqual(['Rust toolchain', 'crypto-bigint (the SRP module)', 'Node in the relay image']);
    expect(result.markdown).toContain('| Pin | Ours | Upstream |');
  });

  it('fails when a source cannot be reached, instead of reporting everything as current', async () => {
    const down = async (url: string) => (url === SOURCES.crate ? Promise.reject(new Error('crates.io answered 503')) : get(url));
    await expect(check({ read: repoFile, get: down, today: TODAY })).rejects.toThrow('503');
  });
});

describe('the workflow', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/upstream-pins.yml', import.meta.url), 'utf8')) as {
    on: { schedule?: unknown[]; workflow_dispatch?: unknown };
    permissions: Record<string, string>;
    jobs: Record<string, { permissions?: Record<string, string>; steps: Array<{ run?: string; env?: Record<string, string> }> }>;
  };
  const job = Object.values(workflow.jobs)[0]!;
  const script = job.steps.map((s) => s.run ?? '').join('\n');

  it('runs weekly and by hand', () => {
    expect(workflow.on.schedule).toHaveLength(1);
    expect(workflow.on).toHaveProperty('workflow_dispatch');
  });

  it('may open and close issues in its one job, and can write nothing else', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toEqual({ contents: 'read', issues: 'write' });
  });

  it('treats "behind" (3) as a result and anything else that fails as a failure', () => {
    expect(script).toContain('scripts/check-upstream-pins.mjs');
    expect(script).toMatch(/-eq 0 \] \|\| \[ "\$status" -eq 3/);
  });

  it('opens or updates one issue while something is behind, and closes it when nothing is', () => {
    expect(script).toContain('gh issue create');
    expect(script).toContain('gh issue edit');
    expect(script).toContain('gh issue close');
  });
});
