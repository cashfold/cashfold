import { describe, expect, it } from 'vitest';
import { readBuildInfo } from './build-info';

describe('reading the build information', () => {
  it('reads the commit and the digest of the web export', () => {
    expect(readBuildInfo('/app', () => JSON.stringify({ commit: 'abc123', webDigest: 'f00', extra: 1 }))).toEqual({ commit: 'abc123', webDigest: 'f00' });
  });

  it('looks in dist/build-info.json of the app', () => {
    let seen = '';
    readBuildInfo('/app', (path) => ((seen = path), '{}'));
    expect(seen.replaceAll('\\', '/')).toBe('/app/dist/build-info.json');
  });

  it('knows nothing when the file is missing, broken or odd', () => {
    expect(readBuildInfo('/app', () => { throw new Error('ENOENT'); })).toEqual({});
    expect(readBuildInfo('/app', () => '{ not json')).toEqual({});
    expect(readBuildInfo('/app', () => JSON.stringify({ commit: 5, webDigest: null }))).toEqual({});
    expect(readBuildInfo('/app', () => JSON.stringify({ commit: '' }))).toEqual({});
  });
});
