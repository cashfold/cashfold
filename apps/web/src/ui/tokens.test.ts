import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Design tokens live in CSS custom properties. These tests hold the colour pairs to WCAG 2.2 AA (FR-094) in both themes.

const css = readFileSync(resolve(import.meta.dirname, '../app/tokens.css'), 'utf8');

function block(source: string, opener: RegExp): string {
  const start = source.search(opener);
  if (start < 0) throw new Error(`no block ${opener}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(source.indexOf('{', start) + 1, i);
  }
  throw new Error('unbalanced block');
}

function tokens(body: string): Record<string, string> {
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1]!, m[2]!]));
}

const light = tokens(block(css, /:root\s*\{/));
const dark = tokens(block(block(css, /@media\s*\(prefers-color-scheme:\s*dark\)/), /:root\s*\{/));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['text', 'bg'], ['text', 'surface'], ['text-muted', 'bg'], ['text-muted', 'surface'],
  ['primary', 'bg'], ['on-primary', 'primary'], ['danger', 'bg'], ['danger', 'surface'], ['success', 'bg'], ['success', 'surface'],
  ['warning', 'bg'], ['warning', 'surface'], ['on-danger', 'danger'],
];

describe.each([['light', light], ['dark', dark]] as const)('%s theme', (_name, theme) => {
  it('defines every token the pairs need', () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      expect(theme[fg], fg).toBeDefined();
      expect(theme[bg], bg).toBeDefined();
    }
  });

  it.each(TEXT_PAIRS)('%s on %s has at least 4.5:1 contrast', (fg, bg) => {
    expect(contrast(theme[fg]!, theme[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps focus rings and borders of interactive controls at 3:1 against the page (non-text contrast)', () => {
    expect(contrast(theme['focus']!, theme['bg']!)).toBeGreaterThanOrEqual(3);
    expect(contrast(theme['border-strong']!, theme['bg']!)).toBeGreaterThanOrEqual(3);
  });
});

describe('gains, losses and warnings are not colour-only (FR-094)', () => {
  it('declares a distinct non-colour cue for each state', () => {
    expect(css).toMatch(/--cue-gain:\s*'\+'/);
    expect(css).toMatch(/--cue-loss:\s*'−'/);
    expect(css).toMatch(/--cue-warning:\s*'!'/);
  });
});

describe('motion and contrast preferences', () => {
  it('honours reduced motion and forced colours', () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(/@media\s*\(forced-colors:\s*active\)/);
  });
});
