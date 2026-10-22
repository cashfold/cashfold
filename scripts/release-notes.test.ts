import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module without types
import { expectedAssets, missingAssets, renderNotes, sha256Sums } from './release-assets.mjs';

// What a release page says and lists (FR-025, FR-027, FR-028): the changelog, how to download and verify, a clear label while builds are
// unsigned, and a checksum for every file somebody can download.

const VERSION = '1.2.3';
const names = expectedAssets(VERSION) as string[];
const base = { version: VERSION, changelog: '### Features\n\n* a thing (abc123)', treeDigest: 'f'.repeat(64), commit: '0123456789abcdef0123456789abcdef01234567', signed: true, assets: names, repository: 'cashfold/cashfold' };

describe('the assets of a release', () => {
  it('are one installer or package per system and format, the update feed of each system, and a signature for each installer that updates itself', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        `Cashfold-${VERSION}-win-x64.exe`,
        `Cashfold-${VERSION}-mac-arm64.dmg`,
        `Cashfold-${VERSION}-mac-arm64.zip`,
        `Cashfold-${VERSION}-mac-x64.dmg`,
        `Cashfold-${VERSION}-mac-x64.zip`,
        `Cashfold-${VERSION}-linux-x64.AppImage`,
        `Cashfold-${VERSION}-linux-x64.deb`,
        `Cashfold-${VERSION}-linux-x64.rpm`,
        'latest.yml',
        'latest-mac.yml',
        'latest-linux.yml',
        `Cashfold-${VERSION}-win-x64.exe.sig`,
        `Cashfold-${VERSION}-mac-arm64.zip.sig`,
        `Cashfold-${VERSION}-mac-x64.zip.sig`,
        `Cashfold-${VERSION}-linux-x64.AppImage.sig`,
        `cashfold-web-v${VERSION}.tar.gz`,
        'SHA256SUMS',
        'SHA256SUMS.tree',
        'TREE_SHA256',
        'sbom.cdx.json',
      ]),
    );
    // Only what updates itself has a signature.
    expect(names.filter((n) => n.endsWith('.sig')).sort()).toEqual([`Cashfold-${VERSION}-linux-x64.AppImage.sig`, `Cashfold-${VERSION}-mac-arm64.zip.sig`, `Cashfold-${VERSION}-mac-x64.zip.sig`, `Cashfold-${VERSION}-win-x64.exe.sig`]);
  });

  it('are listed by name without spaces (GitHub rewrites spaces, which would break the update feed)', () => {
    for (const n of names) expect(n).not.toMatch(/\s/);
  });

  it('are reported missing one by one', () => {
    expect(missingAssets(VERSION, names)).toEqual([]);
    expect(missingAssets(VERSION, names.filter((n) => n !== 'latest-mac.yml' && !n.includes('win-x64.exe.sig')))).toEqual(['latest-mac.yml', `Cashfold-${VERSION}-win-x64.exe.sig`].sort());
  });
});

describe('the checksums file', () => {
  const files = [
    { name: 'b.exe', bytes: Buffer.from('B') },
    { name: 'a.dmg', bytes: Buffer.from('A') },
  ];

  it('lists every file as "<sha256>  <name>", in name order, ending with a newline, so `sha256sum -c` checks it', () => {
    const sum = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    expect(sha256Sums(files)).toBe(`${sum(Buffer.from('A'))}  a.dmg\n${sum(Buffer.from('B'))}  b.exe\n`);
  });

  it('lists a file once even if it is given twice', () => {
    expect(sha256Sums([...files, ...files]).trim().split('\n')).toHaveLength(2);
  });
});

describe('the release notes', () => {
  it('start with the changelog the release proposal made', () => {
    const notes = renderNotes(base) as string;
    expect(notes.indexOf('### Features')).toBeGreaterThanOrEqual(0);
    expect(notes).toContain('* a thing (abc123)');
  });

  it('say loudly, first of all, that an unsigned build is unsigned, and how to open it anyway', () => {
    const notes = renderNotes({ ...base, signed: false }) as string;
    expect(notes.split('\n')[0]).toMatch(/UNSIGNED BUILD/);
    expect(notes).toMatch(/warn/i);
    expect(renderNotes(base)).not.toMatch(/UNSIGNED BUILD/);
  });

  it('offer one download line per system and format', () => {
    const notes = renderNotes(base) as string;
    for (const asset of names.filter((n) => /\.(exe|dmg|zip|AppImage|deb|rpm)$/.test(n))) {
      expect(notes, asset).toContain(`https://github.com/cashfold/cashfold/releases/download/v${VERSION}/${asset}`);
    }
    expect(notes).toMatch(/Windows/);
    expect(notes).toMatch(/macOS/);
    expect(notes).toMatch(/Linux/);
  });

  it('say how to check a download, and how to rebuild the web app to the same digest', () => {
    const notes = renderNotes(base) as string;
    expect(notes).toContain('sha256sum -c SHA256SUMS');
    expect(notes).toContain('gh attestation verify');
    expect(notes).toContain('f'.repeat(64));
    expect(notes).toContain('BUILD_ID=0123456789abcdef0123456789abcdef01234567 node scripts/build-verify.mjs');
  });

  it('point to the source of exactly this version', () => {
    expect(renderNotes(base)).toContain(`https://github.com/cashfold/cashfold/tree/v${VERSION}`);
  });

  it('do not offer a download for a file that is not in the release', () => {
    const notes = renderNotes({ ...base, assets: names.filter((n) => !n.endsWith('.rpm')) }) as string;
    expect(notes).not.toContain('.rpm');
  });
});
