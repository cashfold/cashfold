import { describe, expect, it } from 'vitest';
import { contentTypeFor, resolveAppRequest } from './protocol';

const present = new Set(['index.html', 'settings/index.html', '404.html', '_next/static/chunks/app.js', 'sqlite3mc/sqlite3.wasm', 'fonts/ubuntu.woff2', 'a b/index.html']);
const exists = (file: string): boolean => present.has(file);
const get = (url: string, method = 'GET') => resolveAppRequest({ url, method }, exists);

describe('mapping app://cashfold URLs to files of the export', () => {
  it('serves the home page for the root', () => {
    expect(get('app://cashfold/')).toEqual({ status: 200, file: 'index.html', contentType: 'text/html; charset=utf-8' });
    expect(get('app://cashfold')).toMatchObject({ status: 200, file: 'index.html' });
  });

  it('serves a page directory through its index.html (the export uses trailing slashes)', () => {
    expect(get('app://cashfold/settings/')).toMatchObject({ status: 200, file: 'settings/index.html' });
    expect(get('app://cashfold/settings')).toMatchObject({ status: 200, file: 'settings/index.html' });
  });

  it('serves assets as they are', () => {
    expect(get('app://cashfold/_next/static/chunks/app.js')).toMatchObject({ status: 200, file: '_next/static/chunks/app.js' });
  });

  it('ignores the query string and the fragment', () => {
    expect(get('app://cashfold/settings/?view=data#top')).toMatchObject({ status: 200, file: 'settings/index.html' });
  });

  it('decodes ordinary percent-encoding', () => {
    expect(get('app://cashfold/a%20b/')).toMatchObject({ status: 200, file: 'a b/index.html' });
  });

  it('answers an unknown path with the 404 page and status 404', () => {
    expect(get('app://cashfold/nope/')).toEqual({ status: 404, file: '404.html', contentType: 'text/html; charset=utf-8' });
    expect(get('app://cashfold/missing.js')).toMatchObject({ status: 404, file: '404.html' });
  });
});

describe('requests that must never reach the disk', () => {
  const rejected = { status: 404, file: null };
  it.each([
    ['dot-dot segment', 'app://cashfold/../x'],
    ['dot-dot inside', 'app://cashfold/a/../../x'],
    ['encoded dot-dot', 'app://cashfold/%2e%2e/x'],
    ['mixed-case encoded dot-dot', 'app://cashfold/%2E%2e/x'],
    ['encoded slash after dot-dot', 'app://cashfold/a/..%2f..%2fx'],
    ['encoded slash', 'app://cashfold/a%2fb'],
    ['encoded backslash', 'app://cashfold/a%5cb'],
    ['backslash', 'app://cashfold/a\\b'],
    ['NUL byte', 'app://cashfold/index.html%00.png'],
    ['raw NUL byte', 'app://cashfold/index.html\u0000.png'],
    ['single-dot segment', 'app://cashfold/./settings/'],
    ['malformed percent-encoding', 'app://cashfold/%E0%A4%A'],
  ])('rejects %s', (_name, url) => {
    expect(get(url)).toMatchObject(rejected);
  });

  it('rejects a host other than cashfold', () => {
    expect(get('app://evil/index.html')).toMatchObject(rejected);
    expect(get('app://cashfold.evil/index.html')).toMatchObject(rejected);
    expect(get('app://user@cashfold/index.html')).toMatchObject(rejected);
  });

  it('rejects another scheme', () => {
    expect(get('file:///etc/passwd')).toMatchObject(rejected);
    expect(get('https://cashfold/index.html')).toMatchObject(rejected);
  });

  it('rejects anything but GET and HEAD', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) expect(get('app://cashfold/', method), method).toMatchObject(rejected);
    expect(get('app://cashfold/', 'HEAD')).toMatchObject({ status: 200 });
  });

  it('rejects a URL that does not parse', () => {
    expect(get('not a url')).toMatchObject(rejected);
    expect(get('')).toMatchObject(rejected);
  });

  it('never returns a file path that leaves the root', () => {
    for (const url of ['app://cashfold/..', 'app://cashfold/a/b/../../..', 'app://cashfold/%2e%2e%2f%2e%2e%2fetc']) {
      const result = get(url);
      if (result.file !== null) {
        expect(result.file.startsWith('/')).toBe(false);
        expect(result.file.split('/')).not.toContain('..');
      }
    }
  });
});

describe('content types', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['a.js', 'text/javascript; charset=utf-8'],
    ['a.mjs', 'text/javascript; charset=utf-8'],
    ['a.css', 'text/css; charset=utf-8'],
    ['sqlite3.wasm', 'application/wasm'],
    ['ubuntu.woff2', 'font/woff2'],
    ['manifest.json', 'application/json; charset=utf-8'],
    ['logo.svg', 'image/svg+xml'],
    ['icon.png', 'image/png'],
    ['page.txt', 'text/plain; charset=utf-8'],
    ['unknown.bin', 'application/octet-stream'],
    ['no-extension', 'application/octet-stream'],
    ['UPPER.JS', 'text/javascript; charset=utf-8'],
  ])('%s is %s', (file, type) => {
    expect(contentTypeFor(file)).toBe(type);
  });

  it('serves WebAssembly with the type that streaming compilation needs', () => {
    expect(get('app://cashfold/sqlite3mc/sqlite3.wasm')).toMatchObject({ status: 200, contentType: 'application/wasm' });
  });
});
