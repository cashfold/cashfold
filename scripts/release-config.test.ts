import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The release proposal's rules (specs/003, contract release-pipeline, P-1 and P-2): which changes make a release and how the version moves.

const root = new URL('../', import.meta.url).pathname;
const config = JSON.parse(readFileSync(join(root, 'release-please-config.json'), 'utf8')) as {
  packages: Record<string, Record<string, unknown>>;
};
const manifest = JSON.parse(readFileSync(join(root, '.release-please-manifest.json'), 'utf8')) as Record<string, string>;
const pkg = config.packages['.'] as {
  'release-type': string;
  'initial-version': string;
  'include-component-in-tag': boolean;
  draft: boolean;
  'force-tag-creation': boolean;
  'bump-minor-pre-major': boolean;
  'bump-patch-for-minor-pre-major': boolean;
  'exclude-paths': string[];
  'changelog-sections': Array<{ type: string; section?: string; hidden?: boolean }>;
};

describe('release-please configuration', () => {
  it('describes one package, the repository root, versioned through package.json', () => {
    expect(Object.keys(config.packages)).toEqual(['.']);
    expect(pkg['release-type']).toBe('node');
  });

  it('tags releases vX.Y.Z, with no component name', () => {
    expect(pkg['include-component-in-tag']).toBe(false);
  });

  it('keeps every release a draft until all platforms have built, and makes the tag that starts the release workflow', () => {
    expect(pkg.draft).toBe(true);
    expect(pkg['force-tag-creation']).toBe(true);
  });

  it('follows semantic versioning literally from the first release: a breaking change is a major version, even before 1.0', () => {
    expect(pkg['bump-minor-pre-major']).toBe(false);
    expect(pkg['bump-patch-for-minor-pre-major']).toBe(false);
  });

  it('makes 0.1.0 the first release: with no earlier release release-please ignores the manifest and would otherwise start at 1.0.0', () => {
    expect(pkg['initial-version']).toBe('0.1.0');
  });

  it('keeps the manifest and package.json at the same version, which every release proposal moves together', () => {
    expect(Object.keys(manifest)).toEqual(['.']);
    expect(manifest['.']).toMatch(/^\d+\.\d+\.\d+$/);
    expect((JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version).toBe(manifest['.']);
  });

  it('does not count changes that do not reach the people who run the app', () => {
    for (const path of ['apps/server', 'docs', 'specs', 'e2e', 'tests', 'deploy', '.github', '.specify', '.githooks']) expect(pkg['exclude-paths'], path).toContain(path);
  });

  it('never excludes a place the desktop app or the web app is built from', () => {
    for (const path of ['apps/web', 'apps/desktop', 'packages', 'scripts', 'package.json', 'pnpm-lock.yaml']) {
      expect(pkg['exclude-paths'].some((excluded) => path === excluded || path.startsWith(`${excluded}/`)), path).toBe(false);
    }
  });

  it('hides the types that never reach users from the changelog, shows features and fixes, and does not hide breaking changes', () => {
    const hidden = new Set(pkg['changelog-sections'].filter((s) => s.hidden === true).map((s) => s.type));
    for (const type of ['docs', 'chore', 'test', 'ci', 'build', 'style']) expect(hidden.has(type), type).toBe(true);
    const shown = new Set(pkg['changelog-sections'].filter((s) => s.hidden !== true).map((s) => s.type));
    for (const type of ['feat', 'fix']) expect(shown.has(type), type).toBe(true);
    // release-please writes breaking changes into their own section whatever the type; nothing here may switch that off.
    expect(JSON.stringify(config)).not.toMatch(/breaking.*hidden|hidden.*breaking/i);
  });
});

describe('what the desktop build reads', () => {
  const files = (dir: string): string[] => readdirSync(join(root, dir)).filter((f) => /\.(mjs|ts|json)$/.test(f)).map((f) => join(root, dir, f));
  const read = (path: string): string => readFileSync(path, 'utf8');

  it('does not read from a place whose changes are not counted as releases', () => {
    const excluded = pkg['exclude-paths'].filter((p) => p !== '.github'); // workflows are the pipeline itself, not the app
    // What makes the installers (the test scripts may use a relay, the specs, anything: they are not shipped).
    const reads = [...files('apps/desktop/scripts').filter((f) => /\/(build|package|dev|check-fuses)\.mjs$/.test(f)), join(root, 'apps/desktop/electron-builder.config.mjs'), join(root, 'scripts/lib/tree-digest.mjs'), join(root, 'scripts/lib/update-signature.mjs')];
    for (const file of reads) {
      const text = read(file);
      for (const path of excluded) {
        // A path of the repository root used as an import or a file to read ("../../docs/…", join(root, 'specs/…')), not a word in a comment.
        const escaped = path.replace('.', '\\.');
        const code = text.replace(/\/\/.*$/gm, '');
        expect(new RegExp(`(?:\\.\\./)+${escaped}/|root,\\s*['"]${escaped}/`).test(code), `${file} reads ${path}`).toBe(false);
      }
    }
  });
});
