import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every screen builds its controls from the kit (FR-039, SC-006). The lint rule `ui-kit/no-raw-controls` is the first guard; this test is the
// second, so a rule that is switched off or relaxed still fails here. The only bare elements allowed are the native file input, which the kit has
// no component for, and hidden inputs.

const root = resolve(import.meta.dirname);

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'kit') yield* sources(path);
    } else if (/\.tsx$/.test(name) && !/\.(test|browser\.test)\.tsx$/.test(name)) yield path;
  }
}

/** Bare controls other than file and hidden inputs. */
function offenders(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/<(button|select|textarea|input)\b([^>]*)/g)) {
    const [, tag, rest] = m;
    if (tag === 'input' && /type="(file|hidden)"/.test(rest ?? '')) continue;
    found.push(tag!);
  }
  return found;
}

describe('no bare controls outside the kit', () => {
  it('the detector finds what it should', () => {
    expect(offenders('<button type="button">x</button>')).toEqual(['button']);
    expect(offenders('<input type="checkbox" />')).toEqual(['input']);
    expect(offenders('<input type="file" /><input type="hidden" />')).toEqual([]);
    expect(offenders('<Button>x</Button><Select />')).toEqual([]);
  });

  it('finds the screens it is meant to check', () => {
    expect([...sources(root)].length).toBeGreaterThan(40);
  });

  it.each([...sources(root)].map((f) => [relative(root, f), f] as const))('%s', (_name, file) => {
    expect(offenders(readFileSync(file, 'utf8'))).toEqual([]);
  });
});
