import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module without types
import { checkReleaseTag } from './check-release-tag.mjs';

// A release is built only from a version tag, from the commit the tag names, and from a tree whose package.json already says that version
// (FR-026: one version, written once, shown everywhere). A re-run of the workflow is dispatched on the tag itself.

const ok = { refType: 'tag', refName: 'v1.2.3', packageVersion: '1.2.3', head: 'a'.repeat(40), tagCommit: 'a'.repeat(40) };

describe('the release tag check', () => {
  it('accepts a version tag of the commit being built, with the same version in package.json', () => {
    expect(checkReleaseTag(ok)).toEqual([]);
  });

  it('refuses a run that is not on a tag (a branch cannot publish a release)', () => {
    expect(checkReleaseTag({ ...ok, refType: 'branch', refName: 'main' })).toEqual([expect.stringContaining('tag')]);
  });

  it.each(['1.2.3', 'v1.2', 'v1.2.3.4', 'release-1', 'v1.2.3-beta.1', 'V1.2.3', 'v01.2.3'])('refuses the tag name %s', (refName) => {
    expect(checkReleaseTag({ ...ok, refName, packageVersion: refName.replace(/^v/i, '') })).toEqual([expect.stringContaining('vMAJOR.MINOR.PATCH')]);
  });

  it('refuses a package.json that does not say the tagged version (the release proposal has not been merged, or the tag was made by hand)', () => {
    expect(checkReleaseTag({ ...ok, packageVersion: '1.2.2' })).toEqual([expect.stringContaining('1.2.2')]);
  });

  it('refuses a checkout that is not the tagged commit', () => {
    expect(checkReleaseTag({ ...ok, head: 'b'.repeat(40) })).toEqual([expect.stringContaining('commit')]);
  });

  it('reports every problem at once', () => {
    expect(checkReleaseTag({ refType: 'branch', refName: 'main', packageVersion: '0.0.0', head: 'a'.repeat(40), tagCommit: 'b'.repeat(40) }).length).toBeGreaterThanOrEqual(2);
  });
});
