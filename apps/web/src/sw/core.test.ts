import { describe, expect, it } from 'vitest';
import { cacheName, lookupKey, precache, sha256Hex, staleCaches, type Manifest } from './core';

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

async function manifestOf(files: Record<string, string>): Promise<Manifest> {
  return { version: 'v1', files: await Promise.all(Object.entries(files).map(async ([url, body]) => ({ url, sha256: await sha256Hex(enc(body)) }))) };
}

const fakeCache = () => {
  const store = new Map<string, string>();
  return { store, cache: { put: async (url: string, res: Response) => void store.set(url, await res.text()) } };
};
const fetcher = (files: Record<string, string>, overrides: Record<string, string | 'fail'> = {}) => async (url: string) => {
  const body = overrides[url] ?? files[url];
  if (body === undefined || body === 'fail') return new Response('nope', { status: body === 'fail' ? 500 : 404 });
  return new Response(body);
};

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', async () => {
    expect(await sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('precache (all or nothing, every byte verified)', () => {
  const files = { '/index.html': '<html>home</html>', '/_next/static/a.js': 'console.log(1)', '/accounts/index.html': '<html>acc</html>' };

  it('stores every file once all of them verify', async () => {
    const { store, cache } = fakeCache();
    await precache(await manifestOf(files), cache, fetcher(files));
    expect([...store.keys()].sort()).toEqual(Object.keys(files).sort());
  });

  it('stores nothing when one download fails', async () => {
    const { store, cache } = fakeCache();
    await expect(precache(await manifestOf(files), cache, fetcher(files, { '/_next/static/a.js': 'fail' }))).rejects.toThrow(/\/_next\/static\/a\.js/);
    expect(store.size).toBe(0);
  });

  it('stores nothing when a file does not match its published hash (tampered or stale origin)', async () => {
    const { store, cache } = fakeCache();
    await expect(precache(await manifestOf(files), cache, fetcher(files, { '/index.html': '<html>evil</html>' }))).rejects.toThrow(/hash/);
    expect(store.size).toBe(0);
  });
});

describe('lookupKey maps requests onto precached files', () => {
  const m: Manifest = { version: 'v', files: ['/index.html', '/accounts/index.html', '/404.html', '/_next/static/a.js', '/favicon.ico'].map((url) => ({ url, sha256: '' })) };
  const key = (path: string, navigate = false) => lookupKey(m, new URL(path, 'https://app.test'), navigate);

  it('serves exact assets', () => {
    expect(key('/_next/static/a.js')).toBe('/_next/static/a.js');
    expect(key('/favicon.ico')).toBe('/favicon.ico');
  });

  it('serves pages for trailing-slash and bare paths, ignoring query and hash', () => {
    expect(key('/', true)).toBe('/index.html');
    expect(key('/accounts/', true)).toBe('/accounts/index.html');
    expect(key('/accounts?x=1#y', true)).toBe('/accounts/index.html');
  });

  it('falls back to the 404 page for unknown navigations, and to the network for unknown assets', () => {
    expect(key('/nope/', true)).toBe('/404.html');
    expect(key('/nope.js')).toBeUndefined();
  });

  it('never claims API traffic', () => {
    expect(key('/v1/folds/abc/ops')).toBeUndefined();
  });
});

describe('cache housekeeping', () => {
  it('names caches by version and finds the stale ones', () => {
    expect(cacheName({ version: 'abc' })).toBe('cashfold-abc');
    expect(staleCaches(['cashfold-old', 'cashfold-abc', 'other-thing'], 'cashfold-abc')).toEqual(['cashfold-old']);
  });
});
