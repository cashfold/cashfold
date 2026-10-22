// Post-build hardening of the static export (Constitution VIII, T189). Run after `next build` and before the service worker is built,
// so the worker pins the files as they are served.
//
//  - every external script and stylesheet gets a subresource-integrity hash;
//  - every page gets a Content-Security-Policy <meta> that allows its own files and exactly its own inline scripts (by hash), so there is
//    no 'unsafe-inline' and no 'unsafe-eval';
//  - a page fails the build when it carries a `style=` attribute: `style-src 'self'` blocks it, so it would only show up as a broken layout;
//  - a no-referrer policy;
//  - `_headers`: the policy a host should send as real headers (Netlify / Cloudflare Pages format; the same values are given for nginx
//    and others in docs/self-hosting.md). Headers can say what a <meta> cannot (frame-ancestors, Permissions-Policy, HSTS).
//
// `connect-src` lists where the app may talk to. A person chooses their service address at sign-up, so by default any https:// or wss://
// service is allowed; an operator who serves one service only sets CSP_CONNECT_SOURCES (space separated) to pin it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const out = process.argv[2] ?? new URL('../out/', import.meta.url).pathname;
const connect = (process.env.CSP_CONNECT_SOURCES ?? "https: wss:").split(/\s+/).filter(Boolean);

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const sri = (bytes) => `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
const fileFor = (url) => join(out, decodeURIComponent(url.split(/[?#]/)[0]).replace(/^\//, ''));

function policy(inlineHashes) {
  return [
    "default-src 'none'",
    `script-src 'self' 'wasm-unsafe-eval' ${inlineHashes.map((h) => `'${h}'`).join(' ')}`.trim(),
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${connect.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

let pages = 0;
let scripts = 0;
for (const file of walk(out)) {
  if (!file.endsWith('.html')) continue;
  let html = readFileSync(file, 'utf8');

  const withIntegrity = (tag, attr) => {
    if (/\sintegrity=/.test(tag)) return tag;
    const url = new RegExp(`\\s${attr}="([^"]+)"`).exec(tag)?.[1];
    if (url === undefined || !url.startsWith('/')) return tag; // only the app's own files
    const path = fileFor(url);
    if (!existsSync(path)) throw new Error(`${relative(out, file)} refers to ${url}, which is not in the export`);
    scripts++;
    return tag.replace(/\/?>$/, (end) => ` integrity="${sri(readFileSync(path))}" crossorigin="anonymous"${end}`);
  };
  html = html.replace(/<script\b[^>]*\ssrc="[^"]*"[^>]*>/g, (tag) => withIntegrity(tag, 'src'));
  html = html.replace(/<link\b[^>]*\srel="(?:stylesheet|modulepreload)"[^>]*>/g, (tag) => withIntegrity(tag, 'href'));
  html = html.replace(/<link\b[^>]*\srel="preload"[^>]*\sas="(?:script|style)"[^>]*>/g, (tag) => withIntegrity(tag, 'href'));

  const styled = /<[a-z][^>]*\sstyle=/i.exec(html);
  if (styled) throw new Error(`${relative(out, file)} has a style attribute (${styled[0].slice(0, 80)}); the Content-Security-Policy blocks it. Use a class.`);

  const inline = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\ssrc=/.test(m[1]) || /type="(?:application\/json|application\/ld\+json)"/.test(m[1])) continue;
    if (m[2].trim() !== '') inline.push(sri(Buffer.from(m[2], 'utf8')));
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy([...new Set(inline)]).replaceAll('"', '&quot;')}"/><meta name="referrer" content="no-referrer"/>`;
  if (!/<head[^>]*>/.test(html)) throw new Error(`${relative(out, file)} has no <head>`);
  html = html.replace(/<head[^>]*>/, (head) => `${head}${meta}`);
  writeFileSync(file, html);
  pages++;
}

const headers = `# Send these as real HTTP headers. The pages also carry a Content-Security-Policy <meta> (without frame-ancestors, which only a header can set).
/*
  Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'; object-src 'none'
  Referrer-Policy: no-referrer
  Permissions-Policy: accelerometer=(), ambient-light-sensor=(), bluetooth=(), camera=(), display-capture=(), geolocation=(self), gyroscope=(), hid=(), magnetometer=(), microphone=(), payment=(), publickey-credentials-create=(self), publickey-credentials-get=(self), serial=(), usb=(), interest-cohort=()
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Strict-Transport-Security: max-age=63072000; includeSubDomains

/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: no-cache

/precache-manifest.json
  Cache-Control: no-cache
`;
writeFileSync(join(out, '_headers'), headers);
console.log(`hardened ${pages} pages: ${scripts} integrity hashes, CSP and referrer meta, _headers`);
