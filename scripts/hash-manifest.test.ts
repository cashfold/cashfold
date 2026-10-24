import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module without types
import { parseHashManifest } from './lib/hash-manifest.mjs';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const lines = ['# comment', '', `${H1}  sqlite3.mjs`, `${H2}  sqlite3.wasm`];

describe('parseHashManifest', () => {
  it('reads hash and file name from each line and skips comments and blank lines', () => {
    expect(parseHashManifest(lines.join('\n') + '\n')).toEqual([[H1, 'sqlite3.mjs'], [H2, 'sqlite3.wasm']]);
  });

  it('reads the same pairs when every line ends in CRLF, as after a Windows checkout without LF conversion', () => {
    expect(parseHashManifest(lines.join('\r\n') + '\r\n')).toEqual([[H1, 'sqlite3.mjs'], [H2, 'sqlite3.wasm']]);
  });

  it('reads the committed SQLite manifest, in both line endings', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync('apps/web/vendor/sqlite3mc.sha256', 'utf8').replace(/\r\n/g, '\n');
    const files = parseHashManifest(text).map(([, file]: [string, string]) => file);
    expect(files).toEqual(expect.arrayContaining(['sqlite3.mjs', 'sqlite3.wasm']));
    expect(parseHashManifest(text.replace(/\n/g, '\r\n'))).toEqual(parseHashManifest(text));
  });
});
