import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { INCOMING_LIMITS, type IncomingItem } from '@cashfold/platform';

// Everything that reaches the app from outside (a `cashfold://` link, a file opened from the file manager, an argument of a second launch) is
// untrusted. It is parsed here, with the strict grammar of specs/006-native-desktop-experience/contracts/link-and-file-intake.md, size-checked
// before it is read, and handed to the page only as a request for review. Nothing is acted on at arrival. Links and file paths are never logged in
// full: a log line records the kind, the decision and a reason code.

export const MAX_QUEUED = 8;
/** All the file bytes the shell will hold for a locked page. */
export const MAX_QUEUED_BYTES = 256 * 1024 * 1024;
const MAX_LINK_CHARS = 2048;
const TARGETS = ['overview', 'transactions', 'accounts', 'plan', 'settings'] as const;

export type RefusalReason =
  | 'too-long'
  | 'scheme'
  | 'host'
  | 'fragment'
  | 'user-info'
  | 'port'
  | 'parameter'
  | 'repeated'
  | 'email'
  | 'server'
  | 'secret'
  | 'control'
  | 'encoding'
  | 'target'
  | 'empty'
  | 'not-regular'
  | 'too-large'
  | 'extension'
  | 'name-too-long'
  | 'unreadable'
  | 'queue-full';

export type LinkResult = { readonly ok: true; readonly item: Extract<IncomingItem, { kind: 'link' }> } | { readonly ok: false; readonly reason: RefusalReason };

// A Secret Key (`C1-…`) or a Recovery Key (`R1-…`) anywhere in a link, whatever it is called.
const KEY_PATTERN = /(^|[^A-Za-z0-9])[CR]1-[A-Za-z0-9]/i;
const SECRET_NAME = /key|secret|pass|recover|token/i;
// Controls and whitespace are exactly what is being refused.
const CONTROL_OR_SPACE = /[\u0000- \u007f-\u009f]/;

const refuse = (reason: RefusalReason): LinkResult => ({ ok: false, reason });

function decodeOnce(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/** The result of checking a `cashfold://` link: the item to show for review, or why it was refused. */
export function parseLink(raw: string): LinkResult {
  if (raw.length > MAX_LINK_CHARS) return refuse('too-long');
  if (!/^cashfold:\/\//i.test(raw)) return refuse('scheme');
  if (raw.includes('#')) return refuse('fragment');
  const rest = raw.slice('cashfold://'.length);
  const authorityEnd = rest.search(/[/?]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  if (authority.includes('@')) return refuse('user-info');
  if (authority.includes(':')) return refuse('port');
  const host = authority.toLowerCase();
  if (host !== 'add-device' && host !== 'open') return refuse('host');
  const tail = authorityEnd === -1 ? '' : rest.slice(authorityEnd);
  const queryStart = tail.indexOf('?');
  const path = queryStart === -1 ? tail : tail.slice(0, queryStart);
  const query = queryStart === -1 ? '' : tail.slice(queryStart + 1);

  // Secrets first, on the raw form and on a once-decoded form of the whole link and of every name: no value of a secret is ever looked at further.
  const decodedWhole = decodeOnce(raw);
  if (KEY_PATTERN.test(raw) || (decodedWhole !== undefined && KEY_PATTERN.test(decodedWhole))) return refuse('secret');
  const pairs = query === '' ? [] : query.split('&');
  for (const pair of pairs) {
    const name = pair.split('=')[0] ?? '';
    const decodedName = decodeOnce(name);
    if (SECRET_NAME.test(name) || (decodedName !== undefined && SECRET_NAME.test(decodedName))) return refuse('secret');
  }

  if (host === 'open') {
    if (query !== '') return refuse('parameter');
    const target = path.replace(/^\//, '').replace(/\/$/, '').toLowerCase();
    const found = TARGETS.find((candidate) => candidate === target);
    return found === undefined ? refuse('target') : { ok: true, item: { kind: 'link', name: `open-${found}`, link: { screen: 'open', target: found } } };
  }
  if (path !== '' && path !== '/') return refuse('host');

  const values = new Map<string, string>();
  for (const pair of pairs) {
    const separator = pair.indexOf('=');
    const name = separator === -1 ? pair : pair.slice(0, separator);
    if (name !== 'email' && name !== 'server') return refuse('parameter');
    if (values.has(name)) return refuse('repeated');
    const value = decodeOnce(separator === -1 ? '' : pair.slice(separator + 1));
    if (value === undefined) return refuse('encoding');
    // The value was decoded once; a value that still looks encoded was encoded twice, which is how a check is dodged.
    if (/%[0-9a-f]{2}/i.test(value)) return refuse('encoding');
    if (CONTROL_OR_SPACE.test(value)) return refuse('control');
    values.set(name, value);
  }
  const email = values.get('email');
  const server = values.get('server');
  if (email !== undefined && !(email.length <= 254 && /^[^@]+@[^@]+$/.test(email))) return refuse('email');
  if (server !== undefined && !validServer(server)) return refuse('server');
  return { ok: true, item: { kind: 'link', name: 'add-device', link: { screen: 'add-device', ...(email === undefined ? {} : { email }), ...(server === undefined ? {} : { server }) } } };
}

function validServer(value: string): boolean {
  if (value.length > 300) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === '' && !value.includes('#');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface FileOps {
  /** Opens for reading without waiting for a pipe or a device. */
  open(path: string): number;
  stat(fd: number): { isFile(): boolean; size: number };
  read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number;
  close(fd: number): void;
}

export const nodeFileOps: FileOps = {
  open: (path) => openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)),
  stat: (fd) => fstatSync(fd),
  read: (fd, buffer, offset, length, position) => readSync(fd, buffer, offset, length, position),
  close: (fd) => closeSync(fd),
};

export type FileResult = { readonly ok: true; readonly item: Extract<IncomingItem, { kind: 'csv' | 'backup' }> } | { readonly ok: false; readonly reason: RefusalReason };

/**
 * Opens the path the system gave us and checks, on the open descriptor, that it is a regular file within the limit for its kind, before any of it is
 * read. The page gets the file name only, never the directory.
 */
export function readIncomingFile(path: string, ops: FileOps = nodeFileOps): FileResult {
  const name = basename(path);
  const extension = extname(name).toLowerCase();
  const kind = extension === '.csv' ? 'csv' : extension === '.cashfold-backup' ? 'backup' : undefined;
  if (kind === undefined) return { ok: false, reason: 'extension' };
  if (name.length > INCOMING_LIMITS.nameChars) return { ok: false, reason: 'name-too-long' };
  const limit = kind === 'csv' ? INCOMING_LIMITS.csvBytes : INCOMING_LIMITS.backupBytes;
  let fd: number;
  try {
    fd = ops.open(path);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  try {
    const stat = ops.stat(fd);
    if (!stat.isFile()) return { ok: false, reason: 'not-regular' };
    if (stat.size === 0) return { ok: false, reason: 'empty' };
    if (stat.size > limit) return { ok: false, reason: 'too-large' };
    const bytes = new Uint8Array(stat.size);
    let filled = 0;
    while (filled < stat.size) {
      const got = ops.read(fd, bytes, filled, stat.size - filled, filled);
      if (got <= 0) break;
      filled += got;
    }
    return { ok: true, item: { kind, name, bytes: filled === stat.size ? bytes : bytes.slice(0, filled) } };
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    try {
      ops.close(fd);
    } catch {
      // Nothing more to do with a descriptor that will not close.
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------

/** What an argument of a launch (or an opened file or URL) is: a link, a file to open, or nothing for us. */
export function classifyArgument(argument: string): 'link' | 'file' | 'ignore' {
  if (/^cashfold:\/\//i.test(argument)) return 'link';
  if (argument.startsWith('-')) return 'ignore';
  const extension = extname(argument).toLowerCase();
  return extension === '.csv' || extension === '.cashfold-backup' ? 'file' : 'ignore';
}

export interface IntakeDeps {
  /** Sends an item to the page; false when there is no window. */
  readonly send: (item: IncomingItem) => boolean;
  /** Whether the page has reported its session at least once (it has loaded and can show a message). */
  readonly pageReported: () => boolean;
  /** Whether the page last said it is unlocked. File contents go only while it is. */
  readonly unlocked: () => boolean;
  readonly log: { info(event: string, fields?: Record<string, unknown>): void };
  readonly readFile?: (path: string) => FileResult;
}

export interface Intake {
  /** Takes one argument of a launch, an opened file or an opened URL. */
  accept(argument: string): void;
  /** Delivers what can be delivered now (the page reported, or unlocked). */
  flush(): void;
  /** Forgets everything that is waiting (quit). */
  clear(): void;
  queued(): number;
}

/**
 * The queue between the system and the page. A link or a refusal carries no content, so it is delivered as soon as the page can show it; a file's
 * contents are held here until the page reports `unlocked`, so a locked page never holds them. At most eight items wait; the oldest is refused with a
 * message beyond that. Kept in memory only.
 */
export function createIntake(deps: IntakeDeps): Intake {
  const readFile = deps.readFile ?? ((path: string) => readIncomingFile(path));
  let waiting: IncomingItem[] = [];
  const bytesWaiting = (): number => waiting.reduce((n, item) => n + (item.kind === 'csv' || item.kind === 'backup' ? item.bytes.byteLength : 0), 0);

  const deliverable = (item: IncomingItem): boolean => (item.kind === 'csv' || item.kind === 'backup' ? deps.unlocked() : deps.pageReported());
  const flush = (): void => {
    const keep: IncomingItem[] = [];
    for (const item of waiting) {
      if (deliverable(item) && deps.send(item)) continue;
      keep.push(item);
    }
    waiting = keep;
  };
  const queue = (item: IncomingItem): void => {
    waiting.push(item);
    if (waiting.length > MAX_QUEUED) {
      // The oldest goes, and the person is told so (when the page can show it; a refusal holds no content, so it is not queued itself).
      waiting.shift();
      deps.log.info('intake', { kind: 'queue', decision: 'refused', reason: 'queue-full' });
      if (deps.pageReported()) deps.send({ kind: 'refused', reason: 'queue-full' });
    }
    flush();
  };
  const refused = (kind: string, reason: RefusalReason): void => {
    deps.log.info('intake', { kind, decision: 'refused', reason });
    queue({ kind: 'refused', reason });
  };

  return {
    accept(argument) {
      const what = classifyArgument(argument);
      if (what === 'ignore') return;
      if (what === 'link') {
        const parsed = parseLink(argument);
        if (!parsed.ok) return refused('link', parsed.reason);
        deps.log.info('intake', { kind: 'link', decision: 'accepted' });
        return queue(parsed.item);
      }
      const read = readFile(argument);
      if (!read.ok) return refused('file', read.reason);
      if (bytesWaiting() + read.item.bytes.byteLength > MAX_QUEUED_BYTES) return refused('file', 'queue-full');
      deps.log.info('intake', { kind: read.item.kind, decision: 'accepted' });
      queue(read.item);
    },
    flush,
    clear() {
      waiting = [];
    },
    queued: () => waiting.length,
  };
}
