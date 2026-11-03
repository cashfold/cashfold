import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

// The gates of the constitution's Quality Gates (T007, T009, T010) must all run in CI, `main` must require them through the one check `verify`,
// and the release must not skip them. CI is a set of parallel jobs; `verify` is the last of them and is green only when every other job
// succeeded. The repository can check its own workflow and the protection script; that GitHub applies them is a setting a maintainer makes with
// scripts/apply-branch-protection.sh (docs/desktop.md).

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const release = read('.github/workflows/release.yml');

interface Step { run?: string; uses?: string; with?: Record<string, unknown> }
interface Job { needs?: string | string[]; if?: string; permissions?: Record<string, string>; strategy?: { matrix?: { include?: Array<Record<string, string>> } }; steps?: Step[] }
interface Workflow { permissions?: Record<string, string>; concurrency?: { 'cancel-in-progress': unknown }; jobs: Record<string, Job> }
const ci = parse(read('.github/workflows/ci.yml')) as Workflow;
const jobs = ci.jobs;
const needs = (job: Job): string[] => (job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs]);
const everyStep = Object.values(jobs).flatMap((job) => job.steps ?? []).map((step) => `${step.run ?? ''}\n${step.uses ?? ''}`).join('\n');

describe('quality gates', () => {
  it('CI runs every gate', () => {
    for (const gate of [
      'pnpm typecheck', 'pnpm lint', 'pnpm check:docs', 'pnpm vitest run --coverage', 'pnpm build', 'pnpm check:bundle', 'pnpm check:licenses', 'pnpm check:no-float',
      'pnpm check:desktop-config', 'pnpm check:sqlite3mc', 'pnpm audit --audit-level=high', 'playwright test -c e2e/playwright.config.ts', 'test:browser', 'test:integration',
      'gen-third-party-notices.mjs --check', 'build-verify.mjs', 'gen-migrations.mjs', 'gen-protocol-docs.mjs', 'build-srp-wasm.sh', 'docker build', 'cdxgen',
      'attest-build-provenance',
    ]) expect(everyStep, gate).toContain(gate);
  });

  it('`verify` exists and waits for every other job, so the one required check covers all of CI', () => {
    expect(jobs['verify']).toBeDefined();
    const others = Object.keys(jobs).filter((name) => name !== 'verify').sort();
    expect(needs(jobs['verify']!).sort()).toEqual(others);
  });

  it('`verify` runs even when a job failed, and fails unless every job succeeded (a skipped required check counts as a pass on GitHub)', () => {
    const verify = jobs['verify']!;
    expect(verify.if).toMatch(/always\(\)/);
    const script = (verify.steps ?? []).map((step) => step.run ?? '').join('\n');
    expect(script).toContain('process.env.NEEDS');
    expect(script).toMatch(/result !== "success"/);
    expect(script).toContain('process.exit(1)');
  });

  it('every Playwright project of the e2e config runs in CI, in at least one shard, and the shards of a project cover it', () => {
    const projects = [...read('e2e/playwright.config.ts').matchAll(/^\s*\{ name: '([a-z]+)'/gm)].map((m) => m[1]!).sort();
    expect(projects.length).toBeGreaterThan(0);
    const include = jobs['e2e']!.strategy!.matrix!.include!;
    expect([...new Set(include.map((entry) => entry['project']!))].sort()).toEqual(projects);
    for (const project of projects) {
      const totals = new Set(include.filter((entry) => entry['project'] === project).map((entry) => entry['shard']!.split('/')[1]));
      expect(totals.size, `${project}: every shard of a project must say the same total`).toBe(1);
      const total = Number([...totals][0]);
      const numbers = include.filter((entry) => entry['project'] === project).map((entry) => Number(entry['shard']!.split('/')[0])).sort();
      expect(numbers, `${project}: shards 1..${total}`).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    }
  });

  it('only the build job may make attestations or use the OIDC token; everything else reads the repository', () => {
    expect(ci.permissions).toEqual({ contents: 'read' });
    for (const [name, job] of Object.entries(jobs)) {
      if (name === 'build') {
        expect(job.permissions).toEqual({ contents: 'read', 'id-token': 'write', attestations: 'write' });
      } else {
        expect(job.permissions, name).toBeUndefined();
      }
    }
  });

  it('a newer push cancels an older pull request run, but never a run on main', () => {
    expect(String(ci.concurrency?.['cancel-in-progress'])).toContain("github.event_name == 'pull_request'");
  });

  it('main requires `verify`', () => {
    expect(read('scripts/apply-branch-protection.sh')).toContain('"contexts": ["verify"]');
    expect(jobs['verify']).toBeDefined();
  });

  it('the release repeats the checks and proves the build is reproducible', () => {
    for (const step of ['pnpm vitest run', 'pnpm check:licenses', 'build-verify.mjs', 'cdxgen', 'attest-build-provenance']) expect(release, step).toContain(step);
  });
});

describe('static export hardening (apps/web/scripts/harden-html.mjs)', () => {
  const script = new URL('../apps/web/scripts/harden-html.mjs', import.meta.url).pathname;
  const BOOTSTRAP = "document.documentElement.dataset.theme='dark'";
  const page = (head: string, body = '<p>hi</p>') => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

  function harden(files: Record<string, string>): { status: number | null; output: string; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'cashfold-harden-'));
    for (const [name, html] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), html);
    }
    const run = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
    return { status: run.status, output: `${run.stdout}${run.stderr}`, dir };
  }

  it('fails the build when a page carries a style attribute', () => {
    const { status, output } = harden({ 'index.html': page('<title>x</title>', '<div style="color:red">x</div>') });
    expect(status).not.toBe(0);
    expect(output).toContain('style attribute');
  });

  it('accepts pages without style attributes', () => {
    const { status } = harden({ 'index.html': page('<title>x</title>', '<p class="a">ok</p>') });
    expect(status).toBe(0);
  });

  it("puts the hash of the theme bootstrap script into every page's CSP, and no 'unsafe-inline'", () => {
    const hash = `sha256-${createHash('sha256').update(BOOTSTRAP).digest('base64')}`;
    const files = { 'index.html': page(`<script>${BOOTSTRAP}</script>`), 'overview/index.html': page(`<script>${BOOTSTRAP}</script>`) };
    const { status, dir } = harden(files);
    expect(status).toBe(0);
    for (const name of Object.keys(files)) {
      const html = readFileSync(join(dir, name), 'utf8');
      expect(html, name).toContain(`'${hash}'`);
      expect(html, name).not.toContain("'unsafe-inline'");
    }
  });
});
