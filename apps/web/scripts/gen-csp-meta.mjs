// Emits a CSP <meta> fallback for hosts that cannot set headers.
// Note: frame-ancestors, report-uri and sandbox are ignored in <meta>; headers remain preferred.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'out';
const connect = (process.env.CSP_CONNECT_SOURCES ?? '').split(',').filter(Boolean);
const csp = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${["'self'", ...connect].join(' ')}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const file = join(outDir, 'index.html');
const html = readFileSync(file, 'utf8');
const tag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
writeFileSync(file, html.replace('<head>', `<head>${tag}`));
console.log(`CSP meta injected into ${file}`);
