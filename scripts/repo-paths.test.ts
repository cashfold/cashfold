import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// The release builds the desktop installers on Windows, and a checkout there fails on a path past about 260 characters (the runner's folder
// takes 20 or so of them). Test-run output committed by mistake once broke the first release this way.

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);

describe('tracked files', () => {
  it('have paths a Windows checkout can create', () => {
    expect(files.filter((f) => f.length > 200)).toEqual([]);
  });

  it('have names Windows allows', () => {
    expect(files.filter((f) => /[<>:"|?*\\]|[ .]$|(^|\/)(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\.|\/|$)/i.test(f))).toEqual([]);
  });

  it('do not include tool output that is ignored (test reports, screenshots, coverage)', () => {
    expect(files.filter((f) => /(^|\/)(?:\.vitest|test-results|playwright-report|coverage)\//.test(f))).toEqual([]);
  });
});
