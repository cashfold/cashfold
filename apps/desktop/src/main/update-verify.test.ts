import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error a plain script module without types
import { generateUpdateKeyPair, signUpdate } from '../../../../scripts/lib/update-signature.mjs';
import { nameIsForVersion, signatureUrl, verifyDownload } from './update-verify';

// After an update is downloaded and before it can be installed, the app checks the project's signature on exactly the bytes it got (ADR-0010).

const SOURCE = 'https://github.com/cashfold/cashfold';
const NAME = 'Cashfold-1.3.0-linux-x64.AppImage';
const HASH = Buffer.alloc(64, 5).toString('base64');

async function setup(overrides: Partial<Parameters<typeof verifyDownload>[0]> = {}) {
  const pair = await generateUpdateKeyPair();
  const signature = (await signUpdate(pair.privateKey, NAME, HASH)) as string;
  const fetchText = vi.fn(async () => signature);
  const base: Parameters<typeof verifyDownload>[0] = {
    file: `/cache/${NAME}`,
    version: '1.3.0',
    publicKeys: [pair.publicKey],
    hashFile: vi.fn(async () => HASH),
    fetchText,
    signaturesFrom: `${SOURCE}/releases/download`,
    ...overrides,
  };
  return { base, pair, fetchText, signature };
}

describe('where the signature is fetched from', () => {
  it('is the same release, by construction, never taken from the feed', () => {
    expect(signatureUrl(`${SOURCE}/releases/download`, '1.3.0', NAME)).toBe(`${SOURCE}/releases/download/v1.3.0/${NAME}.sig`);
  });

  it('keeps an odd file name from changing the address', () => {
    expect(signatureUrl(`${SOURCE}/releases/download`, '1.3.0', 'a b#c?d.exe')).toBe(`${SOURCE}/releases/download/v1.3.0/a%20b%23c%3Fd.exe.sig`);
    expect(() => signatureUrl(`${SOURCE}/releases/download`, '1.3.0', '../x.exe')).toThrow();
    expect(() => signatureUrl(`${SOURCE}/releases/download`, '1.3.0', 'a/b.exe')).toThrow();
    expect(() => signatureUrl(`${SOURCE}/releases/download`, '1.3.0', '')).toThrow();
    expect(() => signatureUrl(`${SOURCE}/releases/download`, '../9', NAME)).toThrow();
  });
});

describe('checking a downloaded update', () => {
  it('accepts the genuine file: its own hash, the signature of the same release, a trusted key', async () => {
    const { base, fetchText } = await setup();
    await expect(verifyDownload(base)).resolves.toBe(true);
    expect(fetchText).toHaveBeenCalledWith(`${SOURCE}/releases/download/v1.3.0/${NAME}.sig`);
    expect(base.hashFile).toHaveBeenCalledWith(`/cache/${NAME}`);
  });

  it('refuses a file whose bytes are not the ones that were signed', async () => {
    const { base } = await setup({ hashFile: vi.fn(async () => Buffer.alloc(64, 6).toString('base64')) });
    await expect(verifyDownload(base)).resolves.toBe(false);
  });

  it('refuses a signature by a key the app does not trust, or no trusted key at all', async () => {
    const stranger = await generateUpdateKeyPair();
    const { base } = await setup();
    await expect(verifyDownload({ ...base, publicKeys: [stranger.publicKey] })).resolves.toBe(false);
    await expect(verifyDownload({ ...base, publicKeys: [] })).resolves.toBe(false);
  });

  it('refuses a missing, unreadable or malformed signature, without throwing', async () => {
    const { base } = await setup();
    await expect(verifyDownload({ ...base, fetchText: vi.fn(async () => { throw new Error('404'); }) })).resolves.toBe(false);
    await expect(verifyDownload({ ...base, fetchText: vi.fn(async () => '') })).resolves.toBe(false);
    await expect(verifyDownload({ ...base, fetchText: vi.fn(async () => 'not a signature') })).resolves.toBe(false);
    await expect(verifyDownload({ ...base, hashFile: vi.fn(async () => { throw new Error('EIO'); }) })).resolves.toBe(false);
  });

  it('refuses a signature made for another file name or version', async () => {
    const { base } = await setup();
    await expect(verifyDownload({ ...base, file: '/cache/Cashfold-1.3.0-win-x64.exe' })).resolves.toBe(false);
  });

  it('refuses an old, genuinely signed installer offered as a newer version', async () => {
    const { base } = await setup();
    // The signature on Cashfold-1.3.0-… is good, and a feed (or a stolen release) can serve it again under another version number.
    await expect(verifyDownload({ ...base, version: '9.9.9' })).resolves.toBe(false);
  });

  it('knows which names belong to a version', () => {
    expect(nameIsForVersion('Cashfold-1.3.0-linux-x64.AppImage', '1.3.0')).toBe(true);
    expect(nameIsForVersion('Cashfold-1.3.0-mac-arm64.zip', '1.3.0')).toBe(true);
    expect(nameIsForVersion('Cashfold-1.3.0-win-x64.exe', '1.3.1')).toBe(false);
    expect(nameIsForVersion('Cashfold-1.0.0-beta.1-win-x64.exe', '1.0.0')).toBe(false);
    expect(nameIsForVersion('Cashfold-1.0.0-beta.1-win-x64.exe', '1.0.0-beta.1')).toBe(true);
    expect(nameIsForVersion('Cashfold-1x3x0-win-x64.exe', '1.3.0')).toBe(false);
    expect(nameIsForVersion('Cashfold-1.3.0-win-x64.exe.sig', '1.3.0')).toBe(true); // the extension is not this check's business: the signature is
    expect(nameIsForVersion('x/../Cashfold-1.3.0-win-x64.exe', '1.3.0')).toBe(false);
  });

  it('ignores whitespace around the stored signature', async () => {
    const { base, signature } = await setup();
    await expect(verifyDownload({ ...base, fetchText: vi.fn(async () => `${signature}\n`) })).resolves.toBe(true);
  });
});

describe('reading the file and the signature', () => {
  it('hashes a file with SHA-512, base64, the same form as the update feed and the signature use', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createHash } = await import('node:crypto');
    const { sha512OfFile } = await import('./update-verify');
    const dir = mkdtempSync(join(tmpdir(), 'hash-'));
    const file = join(dir, 'a.bin');
    writeFileSync(file, Buffer.alloc(300_000, 3));
    expect(await sha512OfFile(file)).toBe(createHash('sha512').update(Buffer.alloc(300_000, 3)).digest('base64'));
    await expect(sha512OfFile(join(dir, 'missing'))).rejects.toThrow();
  });

  it('fetches a small signature over https, and refuses everything else', async () => {
    const { fetchSmallText } = await import('./update-verify');
    const ok = vi.fn(async () => new Response('c2ln', { status: 200 }));
    await expect(fetchSmallText('https://github.com/x/y/releases/download/v1.0.0/a.sig', { fetch: ok })).resolves.toBe('c2ln');
    await expect(fetchSmallText('http://github.com/a.sig', { fetch: ok })).rejects.toThrow(/https/);
    await expect(fetchSmallText('file:///etc/passwd', { fetch: ok })).rejects.toThrow();
    await expect(fetchSmallText('https://x/y', { fetch: vi.fn(async () => new Response('no', { status: 404 })) })).rejects.toThrow();
    await expect(fetchSmallText('https://x/y', { fetch: vi.fn(async () => new Response('x'.repeat(5000), { status: 200 })) })).rejects.toThrow(/large/);
  });

  it('allows plain http only to the local test feed a test build was given', async () => {
    const { fetchSmallText } = await import('./update-verify');
    const ok = vi.fn(async () => new Response('c2ln', { status: 200 }));
    await expect(fetchSmallText('http://localhost:5000/v1/a.sig', { fetch: ok, allowHttpPrefix: 'http://localhost:5000/' })).resolves.toBe('c2ln');
    await expect(fetchSmallText('http://localhost:6000/v1/a.sig', { fetch: ok, allowHttpPrefix: 'http://localhost:5000/' })).rejects.toThrow(/https/);
  });
});
