import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The gates of the constitution's Quality Gates (T007, T009, T010) must run in the one CI job that `main` requires, and the release must
// not skip them. The repository can check its own workflow and the protection script; that GitHub applies them is a setting a maintainer
// makes with scripts/apply-branch-protection.sh (docs/desktop.md).

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');

describe('quality gates', () => {
  it('CI runs every gate in the `verify` job', () => {
    expect(ci).toMatch(/^  verify:/m);
    for (const gate of [
      'pnpm typecheck', 'pnpm lint', 'pnpm vitest run --coverage', 'pnpm build', 'pnpm check:bundle', 'pnpm check:licenses', 'pnpm check:no-float', 'pnpm check:desktop-config', 'pnpm check:sqlite3mc',
      'pnpm audit --audit-level=high', 'pnpm test:e2e', 'test:integration', 'gen-third-party-notices.mjs --check', 'build-verify.mjs', 'gen-migrations.mjs', 'gen-protocol-docs.mjs',
    ]) expect(ci, gate).toContain(gate);
  });

  it('there is exactly one job, so the one required check covers all of it', () => {
    expect([...ci.slice(ci.indexOf('\njobs:')).matchAll(/^  ([a-z-]+):\s*$/gm)].map((m) => m[1])).toEqual(['verify']);
  });

  it('main requires `verify`', () => {
    expect(read('scripts/apply-branch-protection.sh')).toContain('"contexts": ["verify"]');
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
