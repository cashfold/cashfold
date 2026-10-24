import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// `new URL(…, import.meta.url).pathname` is "/D:/a/…" on Windows, and joined with a drive it becomes "D:\D:\a\…" (the web build of the first
// release failed on Windows this way). `fileURLToPath` gives the right path on every system.

const scripts = execFileSync('git', ['ls-files', '-z', '--', '*.mjs', '*.js', '*.cjs'], { encoding: 'utf8' })
  .split('\0')
  .filter((f) => f !== '' && !f.endsWith('.test.ts') && !f.includes('/node_modules/'));

describe('scripts that run on the release machines', () => {
  it('do not turn a file URL into a path with .pathname', () => {
    const offenders = scripts.filter((file) => /import\.meta\.url\s*\)\s*\.pathname/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
