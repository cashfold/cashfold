import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The app draws no emoji (spec 019, FR-007): they look different on every system and cannot follow the theme, so the interface uses its own line
// icons. Text a person types is data and is not scanned; this reads the source and the message catalogues, like `no-raw-controls.test.ts`.

const src = resolve(import.meta.dirname, '..');

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(ts|tsx|json)$/.test(name) && !/\.(test|browser\.test)\.(ts|tsx)$/.test(name)) yield path;
  }
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
/** Characters the pattern also matches that are text, not emoji. List each with the file that uses it. */
const ALLOWED = new Set<string>([]);

function emojiIn(text: string): string[] {
  const found: string[] = [];
  text.split('\n').forEach((line, i) => {
    for (const ch of line) if (PICTOGRAPHIC.test(ch) && !ALLOWED.has(ch)) found.push(`line ${i + 1}: ${ch}`);
  });
  return found;
}

describe('no emoji in the app', () => {
  it('the detector finds what it should', () => {
    expect(emojiIn('const a = "🍴 Food";')).toEqual(['line 1: 🍴']);
    expect(emojiIn('plain text, 12.50 USD, → ✓ −')).toEqual([]);
  });

  it('finds the sources it is meant to check', () => {
    expect([...sources(src)].length).toBeGreaterThan(300);
  });

  it('no source file or message catalogue contains an emoji', () => {
    const offenders: string[] = [];
    for (const file of sources(src)) {
      const found = emojiIn(readFileSync(file, 'utf8'));
      if (found.length > 0) offenders.push(`${relative(src, file)} (${found.slice(0, 3).join('; ')})`);
    }
    expect(offenders).toEqual([]);
  });
});
