import { describe, expect, it } from 'vitest';
import { migrate } from './migrate';
import { DEFAULT_PREFS, parsePrefs } from './schema';

describe('migrate', () => {
  it('keeps a version 1 object', () => {
    const v1 = { ...DEFAULT_PREFS, theme: 'dark' as const };
    expect(migrate(v1)).toEqual(v1);
    expect(parsePrefs(JSON.stringify(migrate(v1)))).toEqual(v1);
  });
  it('gives defaults for anything else', () => {
    for (const x of [null, undefined, 3, 'x', [], {}, { v: 0 }, { v: 2 }]) expect(migrate(x)).toEqual(DEFAULT_PREFS);
  });
});
