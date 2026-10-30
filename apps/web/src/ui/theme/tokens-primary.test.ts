import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTE } from './palette';

// tokens.css carries the palette as [data-primary] overrides; this keeps the two in step and keeps the overrides to the primary family (FR-005).
const css = readFileSync(resolve(import.meta.dirname, '../../app/tokens.css'), 'utf8');

function rule(selector: string): Record<string, string> | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) return undefined;
  return Object.fromEntries([...m[1]!.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((x) => [x[1]!, x[2]!.trim()]));
}

describe('primary colour overrides in tokens.css', () => {
  it.each(PALETTE.filter((c) => c.id !== 'emerald').map((c) => [c.id, c] as const))('%s matches the palette in both themes', (id, c) => {
    expect(rule(`[data-primary="${id}"]`)).toEqual({ primary: c.light.primary, 'on-primary': c.light.onPrimary, 'accent-text': c.light.accentText, focus: c.light.focus });
    expect(rule(`[data-theme="dark"][data-primary="${id}"]`)).toEqual({ primary: c.dark.primary, 'on-primary': c.dark.onPrimary, 'accent-text': c.dark.accentText, focus: c.dark.focus });
  });

  it('never touches the meaning colours', () => {
    const overrides = [...css.matchAll(/\[data-primary="[a-z]+"\]\s*\{([^}]*)\}/g)].map((m) => m[1]!).join('\n');
    expect(overrides).not.toMatch(/--(danger|on-danger|success|warning|cue-[a-z]+)\b/);
  });
});
