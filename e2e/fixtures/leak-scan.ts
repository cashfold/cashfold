import { isDeepStrictEqual } from 'node:util';
import type { ConsoleMessage, Page, Request } from '@playwright/test';
import { PREFS_KEY, parsePrefs } from '../../apps/web/src/ui/prefs/schema.js';

// Plaintext-leak scan (SC-002, SC-015). Seed the app with recognisable names, notes and amounts, then search every
// place the browser keeps or sends data for them: OPFS files, IndexedDB, Web Storage, Cache Storage, the console
// and the network. A scan that cannot fail proves nothing, so leak-scan.self-test.spec.ts plants a marker in each
// place and checks it is found.

export interface Seed {
  /** Free text that must never appear outside the encrypted database: names, notes, payees, passwords. */
  readonly strings: readonly string[];
  /** Amounts as the user typed them (`12.50`) and as stored minor units (`1250`). Searched as whole numbers. */
  readonly amounts: readonly string[];
}

export interface Leak {
  readonly where: 'opfs' | 'indexeddb' | 'localstorage' | 'sessionstorage' | 'cachestorage' | 'console' | 'network' | 'url';
  readonly detail: string;
  readonly marker: string;
}

export interface Capture {
  /** Network requests and console lines seen since `start`. */
  stop(): { requests: string[]; console: string[] };
}

/** Encodings a text marker could take in storage: UTF-8/Latin-1, UTF-16 little and big endian. */
export function encodings(text: string): Uint8Array[] {
  const utf8 = new TextEncoder().encode(text);
  const utf16le = new Uint8Array(text.length * 2);
  const utf16be = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    utf16le[i * 2] = c & 0xff;
    utf16le[i * 2 + 1] = c >> 8;
    utf16be[i * 2] = c >> 8;
    utf16be[i * 2 + 1] = c & 0xff;
  }
  return [utf8, utf16le, utf16be];
}

export function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

const isAlnum = (c: string | undefined) => c !== undefined && /[0-9A-Za-z]/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && /[0-9]/.test(c);

/**
 * Whole-number match: `12` is not found inside `1234` or `12.50`, but `12.50` is found in `paid 12.50 today` and
 * `1250` in `total 1250.`. A separator counts as part of the number only when digits sit on both sides of it.
 */
export function containsAmount(text: string, amount: string): boolean {
  for (let at = text.indexOf(amount); at !== -1; at = text.indexOf(amount, at + 1)) {
    const [before, after] = [text[at - 1], text[at + amount.length]];
    const joinedBefore = isAlnum(before) || (/[.,]/.test(before ?? '') && isDigit(text[at - 2]));
    const joinedAfter = isAlnum(after) || (/[.,]/.test(after ?? '') && isDigit(text[at + amount.length + 1]));
    if (!joinedBefore && !joinedAfter) return true;
  }
  return false;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The one localStorage key the app may use is the interface-preferences object (FR-051). Its value must be exactly what the parser keeps
 * (so it holds only enumerated values, ids and dates, as contracts/preferences.schema.json says). Anything else is reported.
 */
export function checkLocalStorage(entriesJson: string): string[] {
  const problems: string[] = [];
  let entries: [string, string][];
  try {
    entries = JSON.parse(entriesJson) as [string, string][];
  } catch {
    return ['localStorage could not be read'];
  }
  for (const [key, value] of entries) {
    if (key !== PREFS_KEY) {
      problems.push(`unexpected localStorage key "${key}"`);
      continue;
    }
    let stored: unknown;
    try {
      stored = JSON.parse(value);
    } catch {
      problems.push(`${PREFS_KEY} is not JSON`);
      continue;
    }
    if (!isDeepStrictEqual(stored, parsePrefs(value))) problems.push(`${PREFS_KEY} does not match the preferences schema`);
  }
  return problems;
}

export function searchText(text: string, seed: Seed): string[] {
  const hits = seed.strings.filter((s) => text.includes(s));
  for (const a of seed.amounts) if (containsAmount(text, a)) hits.push(a);
  return hits;
}

export function startCapture(page: Page): Capture {
  const requests: string[] = [];
  const consoleLines: string[] = [];
  const onRequest = (r: Request) => requests.push(`${r.method()} ${r.url()}\n${JSON.stringify(r.headers())}\n${r.postData() ?? ''}`);
  const onConsole = (m: ConsoleMessage) => consoleLines.push(`${m.type()}: ${m.text()}`);
  const onPageError = (e: Error) => consoleLines.push(`pageerror: ${e.message}\n${e.stack ?? ''}`);
  page.on('request', onRequest);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  return {
    stop() {
      page.off('request', onRequest);
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      return { requests, console: consoleLines };
    },
  };
}

interface Dump {
  opfs: { path: string; base64: string }[];
  opfsErrors: string[];
  indexeddb: { db: string; store: string; json: string }[];
  localStorage: string;
  sessionStorage: string;
  caches: { cache: string; url: string; body: string }[];
  url: string;
}

/** Runs inside the page: reads every OPFS file, IndexedDB record, Web Storage entry and cached response. */
async function dumpBrowserState(): Promise<Dump> {
  const toJson = (v: unknown) =>
    JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x instanceof Uint8Array ? Array.from(x) : x instanceof ArrayBuffer ? Array.from(new Uint8Array(x)) : x));
  const out: Dump = { opfs: [], opfsErrors: [], indexeddb: [], localStorage: '', sessionStorage: '', caches: [], url: location.href };

  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
      else {
        try {
          const buf = new Uint8Array(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer());
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          out.opfs.push({ path: `${prefix}${name}`, base64: btoa(bin) });
        } catch (e) {
          out.opfsErrors.push(`${prefix}${name}: ${(e as Error).name}`);
        }
      }
    }
  };
  try {
    await walk(await navigator.storage.getDirectory(), '/');
  } catch (e) {
    out.opfsErrors.push(`root: ${(e as Error).name}`);
  }

  for (const info of (await indexedDB.databases?.()) ?? []) {
    if (!info.name) continue;
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open(info.name!);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    for (const store of Array.from(db.objectStoreNames)) {
      const rows = await new Promise<unknown[]>((res, rej) => {
        const t = db.transaction(store, 'readonly').objectStore(store);
        const all = t.getAll();
        const keys = t.getAllKeys();
        all.onsuccess = () => {
          keys.onsuccess = () => res([keys.result, all.result]);
        };
        all.onerror = () => rej(all.error);
      });
      out.indexeddb.push({ db: info.name, store, json: toJson(rows) });
    }
    db.close();
  }

  out.localStorage = toJson(Object.entries(localStorage));
  out.sessionStorage = toJson(Object.entries(sessionStorage));

  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      const type = res?.headers.get('content-type') ?? '';
      out.caches.push({ cache: name, url: req.url, body: /text|json|javascript|xml/.test(type) ? await res!.text() : '' });
    }
  }
  return out;
}

export interface ScanOptions {
  readonly seed: Seed;
  readonly capture?: Capture;
}

/** Searches all browser-side storage and the captured console/network for the seeded markers. */
export async function scanForLeaks(page: Page, { seed, capture }: ScanOptions): Promise<Leak[]> {
  const leaks: Leak[] = [];
  const add = (where: Leak['where'], detail: string, markers: string[]) => markers.forEach((marker) => leaks.push({ where, detail, marker }));
  const dump = await page.evaluate(dumpBrowserState);

  for (const f of dump.opfs) {
    const bytes = Uint8Array.from(Buffer.from(f.base64, 'base64'));
    for (const s of seed.strings) if (encodings(s).some((e) => containsBytes(bytes, e))) leaks.push({ where: 'opfs', detail: f.path, marker: s });
    for (const a of seed.amounts) if (encodings(a).some((e) => containsBytes(bytes, e)) && searchText(new TextDecoder('latin1').decode(bytes), { strings: [], amounts: [a] }).length > 0) leaks.push({ where: 'opfs', detail: f.path, marker: a });
  }
  for (const r of dump.indexeddb) add('indexeddb', `${r.db}/${r.store}`, searchText(r.json, seed));
  add('localstorage', 'localStorage', searchText(dump.localStorage, seed));
  add('localstorage', 'localStorage', checkLocalStorage(dump.localStorage));
  add('sessionstorage', 'sessionStorage', searchText(dump.sessionStorage, seed));
  for (const c of dump.caches) add('cachestorage', `${c.cache} ${c.url}`, searchText(`${c.url}\n${c.body}`, seed));
  add('url', dump.url, searchText(safeDecode(dump.url), seed));

  if (capture) {
    const seen = capture.stop();
    seen.console.forEach((line, i) => add('console', `line ${i}`, searchText(line, seed)));
    seen.requests.forEach((req) => add('network', req.split('\n')[0] ?? '', searchText(req, seed)));
  }
  return leaks;
}

export function formatLeaks(leaks: readonly Leak[]): string {
  return leaks.map((l) => `${l.where}: "${l.marker}" in ${l.detail}`).join('\n');
}
