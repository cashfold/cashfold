import { statSync } from 'node:fs';
import { readFile as readFileDefault } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Protocol } from 'electron';
import { APP_ORIGIN } from './identity';
import { headersForPath, type HeaderRule } from './headers';

// Serves the static export from a privileged custom origin. `file://` has an opaque origin, which breaks OPFS, WebAuthn and the policy's
// 'self'; a secure standard scheme gives a stable origin (and so a stable data folder) across versions, without opening a local port.
// The URL → file mapping is a pure function of the request, tested in protocol.test.ts; nothing reaches the disk unless it says so.

export interface Resolved {
  readonly status: 200 | 404;
  /** Path relative to the web root, or null when the request is rejected outright. */
  readonly file: string | null;
  readonly contentType: string;
}

const TEXT = 'text/plain; charset=utf-8';
const TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  wasm: 'application/wasm',
  woff2: 'font/woff2',
  woff: 'font/woff',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  ico: 'image/x-icon',
  txt: TEXT,
};

export function contentTypeFor(file: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return (dot < 0 ? undefined : TYPES[name.slice(dot + 1).toLowerCase()]) ?? 'application/octet-stream';
}

const REJECTED: Resolved = { status: 404, file: null, contentType: TEXT };
const NOT_FOUND = (): Resolved => ({ status: 404, file: '404.html', contentType: TYPES['html']! });
const HOST = new URL(APP_ORIGIN).host;

/**
 * Maps a request for the app origin to a file of the export. `exists` says whether a candidate is present, so the mapping stays pure.
 * Anything that is not a plain GET or HEAD of a clean path on exactly this origin is rejected before a path is even built.
 */
export function resolveAppRequest(request: { readonly url: string; readonly method: string }, exists: (file: string) => boolean): Resolved {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return REJECTED;

  // Work on the raw text: the URL parser would quietly resolve dot segments, and we want to refuse them instead.
  const parts = /^app:\/\/([^/?#]*)([^?#]*)/i.exec(request.url);
  if (parts === null) return REJECTED;
  if ((parts[1] ?? '').toLowerCase() !== HOST) return REJECTED;
  const rawPath = parts[2] ?? '';
  if (/[\u0000-\u001f\u007f\\]/.test(rawPath) || /%(?:00|5c|2f)/i.test(rawPath)) return REJECTED;

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath === '' ? '/' : rawPath);
  } catch {
    return REJECTED;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return REJECTED;
  const segments = decoded.split('/').filter((s) => s !== '');
  if (segments.some((s) => s === '.' || s === '..')) return REJECTED;

  const relative = segments.join('/');
  const last = segments.at(-1) ?? '';
  const candidate = relative === '' ? 'index.html' : decoded.endsWith('/') || !last.includes('.') ? `${relative}/index.html` : relative;
  return exists(candidate) ? { status: 200, file: candidate, contentType: contentTypeFor(candidate) } : NOT_FOUND();
}

export interface AppRequestHandlerOptions {
  readonly webRoot: string;
  readonly rules: readonly HeaderRule[];
  /** Overridable for tests. Small local files, so a synchronous check keeps the mapping simple; inside an asar archive it is patched by Electron. */
  readonly isFile?: (absolute: string) => boolean;
  readonly readFile?: (absolute: string) => Promise<Uint8Array>;
}

/** The handler for `protocol.handle('app', …)`: resolves, reads from inside the web root only, and attaches the export's headers. */
export function createAppRequestHandler(options: AppRequestHandlerOptions): (request: Request) => Promise<Response> {
  const root = resolve(options.webRoot);
  const isFile = options.isFile ?? ((p: string) => statSync(p, { throwIfNoEntry: false })?.isFile() === true);
  const readFile = options.readFile ?? readFileDefault;
  /** Belt and braces: even a path the mapping accepted must stay under the web root. */
  const inside = (file: string): string | undefined => {
    const absolute = resolve(root, file);
    return absolute.startsWith(root + sep) ? absolute : undefined;
  };

  return async (request) => {
    const pathname = new URL(request.url.replace(/^app:/i, 'http:')).pathname;
    const resolved = resolveAppRequest(request, (file) => {
      const absolute = inside(file);
      return absolute !== undefined && isFile(absolute);
    });
    const absolute = resolved.file === null ? undefined : inside(resolved.file);
    if (absolute === undefined || !isFile(absolute)) return respond(404, 'Not found', TEXT, options.rules, pathname);
    const body = request.method.toUpperCase() === 'HEAD' ? null : await readFile(absolute);
    return respond(resolved.status, body, resolved.contentType, options.rules, pathname);
  };
}

function respond(status: number, body: Uint8Array | string | null, contentType: string, rules: readonly HeaderRule[], pathname: string): Response {
  const headers = new Headers(headersForPath(rules, pathname));
  headers.set('Content-Type', contentType);
  return new Response(body as ConstructorParameters<typeof Response>[0], { status, headers });
}

/** Must run before the app is ready: makes `app:` a secure, standard origin that supports fetch and streaming (WebAssembly, workers, OPFS, WebAuthn). */
export function registerAppScheme(protocol: Pick<Protocol, 'registerSchemesAsPrivileged'>): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}

/** Starts answering requests for the app origin. */
export function serveApp(protocol: Pick<Protocol, 'handle'>, options: AppRequestHandlerOptions): void {
  protocol.handle('app', createAppRequestHandler(options));
}
