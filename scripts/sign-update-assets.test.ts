import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module without types
import { generateUpdateKeyPair, verifyUpdate } from './lib/update-signature.mjs';

// The release signs every installer that updates itself. The script is run over the folder the release job assembled.

const script = new URL('./sign-update-assets.mjs', import.meta.url).pathname;
const V = '1.2.3';
const INSTALLERS = {
  win: `Cashfold-${V}-win-x64.exe`,
  macArm: `Cashfold-${V}-mac-arm64.zip`,
  macX64: `Cashfold-${V}-mac-x64.zip`,
  appImage: `Cashfold-${V}-linux-x64.AppImage`,
};
const OTHERS = [`Cashfold-${V}-mac-arm64.dmg`, `Cashfold-${V}-mac-x64.dmg`, `Cashfold-${V}-linux-x64.deb`, `Cashfold-${V}-linux-x64.rpm`, `Cashfold-${V}-win-x64.exe.blockmap`];
const sha512 = (bytes: Buffer): string => createHash('sha512').update(bytes).digest('base64');

function release(options: { omit?: string; feedHashFor?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'sign-assets-'));
  const bytes = (name: string) => Buffer.from(`bytes of ${name}`);
  for (const name of [...Object.values(INSTALLERS), ...OTHERS]) if (name !== options.omit) writeFileSync(join(dir, name), bytes(name));
  const feed = (urls: string[]) =>
    `version: ${V}\nfiles:\n${urls.map((u) => `  - url: ${u}\n    sha512: ${options.feedHashFor === u ? 'AAAA' : sha512(bytes(u))}\n    size: 1\n`).join('')}path: ${urls[0]}\nsha512: ${sha512(bytes(urls[0]!))}\n`;
  writeFileSync(join(dir, 'latest.yml'), feed([INSTALLERS.win]));
  writeFileSync(join(dir, 'latest-mac.yml'), feed([INSTALLERS.macArm, INSTALLERS.macX64]));
  writeFileSync(join(dir, 'latest-linux.yml'), feed([INSTALLERS.appImage]));
  return dir;
}
const run = (dir: string, key: string | undefined) => spawnSync(process.execPath, [script, dir], { encoding: 'utf8', env: { ...process.env, ...(key === undefined ? { UPDATE_SIGNING_KEY: '' } : { UPDATE_SIGNING_KEY: key }) } });

describe('signing the installers that update themselves', async () => {
  const pair = await generateUpdateKeyPair();

  it('writes a signature next to the Windows installer, both Mac zips and the AppImage, and nowhere else', async () => {
    const dir = release();
    const result = run(dir, pair.privateKey);
    expect(result.status, result.stderr).toBe(0);
    const sigs = readdirSync(dir).filter((f) => f.endsWith('.sig')).sort();
    expect(sigs).toEqual(Object.values(INSTALLERS).map((n) => `${n}.sig`).sort());
    for (const other of OTHERS) expect(existsSync(join(dir, `${other}.sig`)), other).toBe(false);
  });

  it('writes signatures that verify under the matching public key, over the hash the update feed lists', async () => {
    const dir = release();
    expect(run(dir, pair.privateKey).status).toBe(0);
    for (const name of Object.values(INSTALLERS)) {
      const signature = readFileSync(join(dir, `${name}.sig`), 'utf8').trim();
      expect(await verifyUpdate([pair.publicKey], name, sha512(Buffer.from(`bytes of ${name}`)), signature), name).toBe(true);
      const stranger = await generateUpdateKeyPair();
      expect(await verifyUpdate([stranger.publicKey], name, sha512(Buffer.from(`bytes of ${name}`)), signature), name).toBe(false);
    }
  });

  it('stops, naming the missing installer, when one is absent', () => {
    const dir = release({ omit: INSTALLERS.macX64 });
    const result = run(dir, pair.privateKey);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(INSTALLERS.macX64);
    expect(readdirSync(dir).filter((f) => f.endsWith('.sig'))).toEqual([]); // nothing half-signed
  });

  it('stops when the update feed does not agree with the file, naming it', () => {
    const dir = release({ feedHashFor: INSTALLERS.win });
    const result = run(dir, pair.privateKey);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(INSTALLERS.win);
    expect(readdirSync(dir).filter((f) => f.endsWith('.sig'))).toEqual([]);
  });

  it('stops without a key, says so, and never prints a key', () => {
    const none = run(release(), undefined);
    expect(none.status).not.toBe(0);
    expect(none.stderr).toContain('UPDATE_SIGNING_KEY');
    const bad = run(release(), 'definitely not a key');
    expect(bad.status).not.toBe(0);
    expect(`${bad.stdout}${bad.stderr}`).not.toContain('definitely not a key');
    const withKey = run(release(), pair.privateKey);
    expect(`${withKey.stdout}${withKey.stderr}`).not.toContain(pair.privateKey);
  });

  it('takes the key from the environment only, never from an argument', () => {
    const dir = release();
    const result = spawnSync(process.execPath, [script, dir, pair.privateKey], { encoding: 'utf8', env: { ...process.env, UPDATE_SIGNING_KEY: '' } });
    expect(result.status).not.toBe(0);
  });
});
