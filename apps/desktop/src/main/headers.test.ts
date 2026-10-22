import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { headersForPath, loadResponseHeaders, parseHeadersFile } from './headers';

// The format written by apps/web/scripts/harden-html.mjs: a path pattern line, then indented `Name: value` lines.
const SAMPLE = `# Send these as real HTTP headers. The pages also carry a Content-Security-Policy <meta> (without frame-ancestors, which only a header can set).
/*
  Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'; object-src 'none'
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), geolocation=(self), publickey-credentials-get=(self)
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Strict-Transport-Security: max-age=63072000; includeSubDomains

/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: no-cache
`;

describe('parsing the headers file of the web export', () => {
  const rules = parseHeadersFile(SAMPLE);

  it('reads every block, ignoring comments and blank lines', () => {
    expect(rules.map((r) => r.pattern)).toEqual(['/*', '/_next/static/*', '/sw.js']);
  });

  it('gives every page the security headers', () => {
    const headers = headersForPath(rules, '/accounts/');
    for (const name of ['Content-Security-Policy', 'Referrer-Policy', 'Permissions-Policy', 'X-Content-Type-Options', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy']) {
      expect(headers[name], name).toBeTypeOf('string');
    }
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  });

  it('drops Strict-Transport-Security: it means nothing for a local origin', () => {
    expect(Object.keys(headersForPath(rules, '/')).map((k) => k.toLowerCase())).not.toContain('strict-transport-security');
  });

  it('adds the headers of the blocks that match the path', () => {
    expect(headersForPath(rules, '/_next/static/chunks/a.js')['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(headersForPath(rules, '/sw.js')['Cache-Control']).toBe('no-cache');
    expect(headersForPath(rules, '/accounts/')['Cache-Control']).toBeUndefined();
  });

  it('keeps a colon inside a value', () => {
    const [rule] = parseHeadersFile('/*\n  Content-Security-Policy: default-src \'none\'; connect-src https: wss:\n');
    expect(rule?.headers['Content-Security-Policy']).toBe("default-src 'none'; connect-src https: wss:");
  });
});

describe('a file that cannot be trusted is an error, not an empty policy', () => {
  it('rejects an empty file', () => {
    expect(() => parseHeadersFile('')).toThrow(/no rules|empty/i);
  });

  it('rejects a file with only comments', () => {
    expect(() => parseHeadersFile('# nothing here\n')).toThrow();
  });

  it('rejects a file with no rule for every path', () => {
    expect(() => parseHeadersFile('/sw.js\n  Cache-Control: no-cache\n')).toThrow(/\/\*/);
  });

  it('rejects a rule for every path that has no Content-Security-Policy', () => {
    expect(() => parseHeadersFile('/*\n  Referrer-Policy: no-referrer\n')).toThrow(/Content-Security-Policy/);
  });

  it('rejects a header line before any path', () => {
    expect(() => parseHeadersFile('  Content-Security-Policy: x\n/*\n  Content-Security-Policy: x\n')).toThrow(/before|path/i);
  });

  it('rejects a header line without a colon', () => {
    expect(() => parseHeadersFile('/*\n  Content-Security-Policy x\n')).toThrow(/line 2/);
  });
});

describe('loading from a web export', () => {
  it('reads _headers from the web root', () => {
    const root = mkdtempSync(join(tmpdir(), 'web-root-'));
    writeFileSync(join(root, '_headers'), SAMPLE);
    expect(loadResponseHeaders(root).map((r) => r.pattern)).toContain('/*');
  });

  it('fails clearly when the export has no _headers', () => {
    const root = mkdtempSync(join(tmpdir(), 'web-root-'));
    mkdirSync(join(root, 'x'));
    expect(() => loadResponseHeaders(root)).toThrow(/_headers/);
  });
});
