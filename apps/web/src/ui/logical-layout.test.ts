import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Right-to-left support (FR-095) depends on never hard-coding left/right. Tailwind has logical utilities for
// everything below; use `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`/`text-end`/`border-s`/`rounded-s`.

const root = resolve(import.meta.dirname, '..');

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(tsx|css)$/.test(name)) yield path;
  }
}

const PHYSICAL_UTILITY = /(?<![\w-])(?:-?(?:m|p)[lr]-|(?:left|right)-(?!\[?(?:auto)\]?\b)\S|text-(?:left|right)\b|float-(?:left|right)\b|clear-(?:left|right)\b|border-[lr](?:-|\b)|rounded-(?:l|r|tl|tr|bl|br)(?:-|\b)|scroll-(?:m|p)[lr]-)/;
const PHYSICAL_CSS = /(?<![\w-])(?:margin|padding)-(?:left|right)\s*:|(?<![\w-])(?:left|right)\s*:\s*(?!auto)|text-align\s*:\s*(?:left|right)|border-(?:left|right)(?:-\w+)?\s*:|float\s*:\s*(?:left|right)/;

describe('no physical left/right in components or styles', () => {
  const sources = [...files(root)].filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));

  it('finds the sources it is meant to check', () => {
    expect(sources.length).toBeGreaterThan(3);
  });

  it('the patterns do catch physical utilities and declarations', () => {
    for (const bad of ['ml-4', 'pr-2', '-ml-1', 'left-0', 'text-right', 'border-l', 'rounded-tl-lg', 'float-right']) expect(PHYSICAL_UTILITY.test(`class="${bad}"`), bad).toBe(true);
    for (const ok of ['ms-4', 'pe-2', 'start-0', 'text-start', 'border-s', 'rounded-ss-lg', 'inset-x-0', 'left-auto']) expect(PHYSICAL_UTILITY.test(`class="${ok}"`), ok).toBe(false);
    for (const bad of ['margin-left: 4px', 'padding-right:0', 'left: 0', 'text-align: right']) expect(PHYSICAL_CSS.test(bad), bad).toBe(true);
    for (const ok of ['margin-inline-start: 4px', 'inset-inline-end: 0', 'text-align: start']) expect(PHYSICAL_CSS.test(ok), ok).toBe(false);
  });

  it.each(sources.map((f) => [relative(root, f), f] as const))('%s', (_name, file) => {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const lines = text.split('\n').map((l, i) => [i + 1, l] as const);
    const offenders = lines.filter(([, l]) => (file.endsWith('.css') ? PHYSICAL_CSS.test(l) : PHYSICAL_UTILITY.test(l)));
    expect(offenders.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
  });
});
