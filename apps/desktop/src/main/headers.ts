import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The web export carries its response headers in a Netlify-style `_headers` file (written by apps/web/scripts/harden-html.mjs). The
// desktop app applies exactly those headers to what it serves, so the web build and the desktop app share one policy and there is no second
// one to keep in step. A file that cannot be read as expected is an error: the alternative is silently serving pages without their policy.

export interface HeaderRule {
  readonly pattern: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Strict-Transport-Security means nothing for a local origin. */
const DROPPED = new Set(['strict-transport-security']);

export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: Array<{ pattern: string; headers: Record<string, string> }> = [];
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const lineNo = index + 1;
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (/^\s/.test(raw)) {
      const rule = rules.at(-1);
      if (rule === undefined) throw new Error(`_headers line ${lineNo}: a header line comes before any path`);
      const colon = raw.indexOf(':');
      if (colon < 1) throw new Error(`_headers line ${lineNo}: expected "Name: value"`);
      rule.headers[raw.slice(0, colon).trim()] = raw.slice(colon + 1).trim();
    } else {
      rules.push({ pattern: raw.trim(), headers: {} });
    }
  }
  if (rules.length === 0) throw new Error('_headers has no rules');
  const everyPath = rules.find((r) => r.pattern === '/*');
  if (everyPath === undefined) throw new Error('_headers has no "/*" rule, so pages would be served without their security headers');
  if (!Object.keys(everyPath.headers).some((name) => name.toLowerCase() === 'content-security-policy')) {
    throw new Error('_headers "/*" rule has no Content-Security-Policy');
  }
  return rules;
}

const matches = (pattern: string, pathname: string): boolean => (pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern);

/** The headers for one request path: the blocks that match it, later ones overriding earlier ones. */
export function headersForPath(rules: readonly HeaderRule[], pathname: string): Record<string, string> {
  const merged = new Map<string, [string, string]>();
  for (const rule of rules) {
    if (!matches(rule.pattern, pathname)) continue;
    for (const [name, value] of Object.entries(rule.headers)) {
      if (DROPPED.has(name.toLowerCase())) continue;
      merged.set(name.toLowerCase(), [name, value]);
    }
  }
  return Object.fromEntries(merged.values());
}

export function loadResponseHeaders(webRoot: string): HeaderRule[] {
  const file = join(webRoot, '_headers');
  if (!existsSync(file)) throw new Error(`${file} is missing: the web export must contain its _headers file`);
  return parseHeadersFile(readFileSync(file, 'utf8'));
}
