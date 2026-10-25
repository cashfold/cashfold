import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module without types
import { checkDesktopConfig } from './check-desktop-config.mjs';

const KEY = Buffer.alloc(32, 7).toString('base64');

interface Options {
  version?: string;
  identity?: Record<string, unknown>;
  builder?: string | null;
}

/** A throwaway repository layout with just the desktop files the check reads. */
function fixture({ version = '0.0.0', identity = {}, builder }: Options = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-config-'));
  mkdirSync(join(root, 'apps/desktop/src/main'), { recursive: true });
  writeFileSync(join(root, 'apps/desktop/package.json'), JSON.stringify({ name: '@cashfold/desktop', version }));
  writeFileSync(join(root, 'apps/desktop/src/main/identity.json'), JSON.stringify({ name: 'Cashfold', appId: 'org.cashfold.app', updatePublicKeys: [], ...identity }));
  if (builder !== null) {
    writeFileSync(
      join(root, 'apps/desktop/electron-builder.config.mjs'),
      builder ??
        `import { readFileSync } from 'node:fs';
const identity = JSON.parse(readFileSync(new URL('./src/main/identity.json', import.meta.url), 'utf8'));
export default { appId: identity.appId, productName: identity.name, mac: { target: [{ target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }] } };\n`,
    );
  }
  return root;
}

describe('the desktop configuration check', () => {
  it('passes for a consistent development configuration', async () => {
    expect(await checkDesktopConfig({ root: fixture() })).toEqual([]);
  });

  it('fails when the desktop package version is not 0.0.0 (the release version comes from the root package only)', async () => {
    const problems = await checkDesktopConfig({ root: fixture({ version: '1.2.3' }) });
    expect(problems).toEqual([expect.stringContaining('version')]);
  });

  it('fails when the packaging configuration hard-codes a different app id', async () => {
    const builder = "export default { appId: 'org.example.other', productName: 'Cashfold' };\n";
    const problems = await checkDesktopConfig({ root: fixture({ builder }) });
    expect(problems).toEqual([expect.stringMatching(/appId/)]);
  });

  it('fails when the packaging configuration uses a different product name', async () => {
    const builder = "export default { appId: 'org.cashfold.app', productName: 'Cashfold Desktop' };\n";
    const problems = await checkDesktopConfig({ root: fixture({ builder }) });
    expect(problems).toEqual([expect.stringMatching(/productName|name/)]);
  });

  it('accepts a missing packaging configuration until it exists', async () => {
    expect(await checkDesktopConfig({ root: fixture({ builder: null }) })).toEqual([]);
  });

  describe('for a release', () => {
    it('requires the packaging configuration', async () => {
      const problems = await checkDesktopConfig({ root: fixture({ builder: null }), release: true });
      expect(problems).toEqual(expect.arrayContaining([expect.stringContaining('electron-builder.config.mjs')]));
    });

    it('fails with no update public key', async () => {
      const problems = await checkDesktopConfig({ root: fixture(), release: true });
      expect(problems).toEqual([expect.stringContaining('updatePublicKeys')]);
    });

    it('fails with more than two keys, or a key that is not a raw 32-byte Ed25519 key', async () => {
      const other = Buffer.alloc(32, 9).toString('base64');
      const third = Buffer.alloc(32, 11).toString('base64');
      expect(await checkDesktopConfig({ root: fixture({ identity: { updatePublicKeys: [KEY, other, third] } }), release: true })).toEqual([expect.stringContaining('at most two')]);
      expect(await checkDesktopConfig({ root: fixture({ identity: { updatePublicKeys: ['not-a-key'] } }), release: true })).toEqual([expect.stringContaining('32-byte')]);
    });

    it('refuses a bundle that carries the test feed, whatever the flags say', async () => {
      const root = fixture({ identity: { updatePublicKeys: [KEY] } });
      mkdirSync(join(root, 'apps/desktop/dist/main'), { recursive: true });
      writeFileSync(join(root, 'apps/desktop/dist/main/index.cjs'), "const feed = process.env['CASHFOLD_TEST_FEED'];\n");
      expect(await checkDesktopConfig({ root, release: true })).toEqual([expect.stringContaining('test feed')]);
    });

    it('refuses a build that was made with the test-feed flag', async () => {
      const root = fixture({ identity: { updatePublicKeys: [KEY] } });
      mkdirSync(join(root, 'apps/desktop/dist/main'), { recursive: true });
      writeFileSync(join(root, 'apps/desktop/dist/main/index.cjs'), '// clean\n');
      writeFileSync(join(root, 'apps/desktop/dist/build-info.json'), JSON.stringify({ testFeed: true }));
      expect(await checkDesktopConfig({ root, release: true })).toEqual([expect.stringContaining('test feed')]);
    });

    it('refuses a bundle that carries the packaged-test hooks, and a build made with them', async () => {
      const root = fixture({ identity: { updatePublicKeys: [KEY] } });
      mkdirSync(join(root, 'apps/desktop/dist/main'), { recursive: true });
      writeFileSync(join(root, 'apps/desktop/dist/main/index.cjs'), "globalThis.__cashfoldTest = {};\n");
      expect(await checkDesktopConfig({ root, release: true })).toEqual([expect.stringContaining('test hooks')]);
      writeFileSync(join(root, 'apps/desktop/dist/main/index.cjs'), '// clean\n');
      writeFileSync(join(root, 'apps/desktop/dist/build-info.json'), JSON.stringify({ testFeed: false, testHooks: true }));
      expect(await checkDesktopConfig({ root, release: true })).toEqual([expect.stringContaining('test hooks')]);
    });

    it('refuses a release made with the test-build switch (the inspector fuse stays on)', async () => {
      const problems = await checkDesktopConfig({ root: fixture({ identity: { updatePublicKeys: [KEY] } }), release: true, env: { CASHFOLD_TEST_BUILD: '1' } });
      expect(problems).toEqual([expect.stringContaining('CASHFOLD_TEST_BUILD')]);
    });

    it('accepts a clean bundle of a release build', async () => {
      const root = fixture({ identity: { updatePublicKeys: [KEY] } });
      mkdirSync(join(root, 'apps/desktop/dist/main'), { recursive: true });
      writeFileSync(join(root, 'apps/desktop/dist/main/index.cjs'), '// clean\n');
      writeFileSync(join(root, 'apps/desktop/dist/build-info.json'), JSON.stringify({ testFeed: false }));
      expect(await checkDesktopConfig({ root, release: true })).toEqual([]);
    });

    it('refuses a release that does not build the Mac zip (it is what in-app updates on macOS install, and latest-mac.yml describes)', async () => {
      const builder = "export default { appId: 'org.cashfold.app', productName: 'Cashfold', mac: { target: [{ target: 'dmg' }] } };\n";
      const problems = await checkDesktopConfig({ root: fixture({ builder, identity: { updatePublicKeys: [KEY] } }), release: true });
      expect(problems).toEqual([expect.stringContaining('zip')]);
    });

    it('accepts the Mac targets written as plain names', async () => {
      const builder = "export default { appId: 'org.cashfold.app', productName: 'Cashfold', mac: { target: ['dmg', 'zip'] } };\n";
      expect(await checkDesktopConfig({ root: fixture({ builder, identity: { updatePublicKeys: [KEY] } }), release: true })).toEqual([]);
    });

    it('passes with one or two good keys', async () => {
      const other = Buffer.alloc(32, 9).toString('base64');
      expect(await checkDesktopConfig({ root: fixture({ identity: { updatePublicKeys: [KEY] } }), release: true })).toEqual([]);
      expect(await checkDesktopConfig({ root: fixture({ identity: { updatePublicKeys: [KEY, other] } }), release: true })).toEqual([]);
    });
  });
});
