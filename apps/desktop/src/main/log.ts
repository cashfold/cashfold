import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The shell's own log: structured JSON lines, redacted by the *type* of a value rather than by hoping callers are careful
// (Constitution VIII: amounts, names, notes and keys never reach a log). IPC payloads are never logged at all: `ipc()` takes a channel and an outcome only.

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** One line per IPC call: the channel and whether it was served, refused or failed. Never the payload. */
  ipc(channel: string, outcome: 'ok' | 'rejected' | 'error'): void;
}

export interface LoggerOptions {
  readonly dir: string;
  /** The user-data folder; it never appears in a line. */
  readonly dataDir: string;
  readonly maxBytes?: number;
  /** How many files to keep, the current one included. */
  readonly maxFiles?: number;
  /** Also print to the console: for development only, never in a packaged build. */
  readonly console?: boolean;
  readonly now?: () => Date;
}

const EVENT = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_DEPTH = 4;
const SECRET_KEY = /pass|secret|token|authorization|cookie|api[-_]?key|private|credential|session|seed|mnemonic|recovery/i;
const SECRET_PARAM = /token|key|secret|pass|auth|sig|code|session/i;
const HEX_KEY = /\b[0-9a-fA-F]{64,}\b/g;
const BASE64_KEY = /[A-Za-z0-9+/_-]{43,}={0,2}/g;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>]+/gi;

function redactUrl(text: string): string {
  try {
    const url = new URL(text);
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) if (SECRET_PARAM.test(name)) url.searchParams.set(name, '[redacted]');
    return url.toString().replace(/%5Bredacted%5D/g, '[redacted]');
  } catch {
    return '[url]';
  }
}

function redactString(value: string, dataDir: string): string {
  let out = value;
  for (const variant of new Set([dataDir, dataDir.replaceAll('\\', '/'), dataDir.replaceAll('/', '\\')])) if (variant !== '') out = out.split(variant).join('[data-dir]');
  out = out.replace(URL_IN_TEXT, (match) => redactUrl(match));
  return out.replace(HEX_KEY, '[key-material]').replace(BASE64_KEY, '[key-material]');
}

function redact(value: unknown, dataDir: string, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[depth]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactString(value, dataDir);
  if (typeof value === 'bigint') return '[bigint]';
  if (value instanceof Uint8Array) return `[bytes ${value.byteLength}]`;
  if (value instanceof Error) return { name: value.name, message: redactString(value.message, dataDir) };
  if (Array.isArray(value)) return value.map((item) => redact(item, dataDir, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(inner, dataDir, depth + 1);
    return out;
  }
  return undefined;
}

export function createLogger(options: LoggerOptions): Logger {
  const maxBytes = options.maxBytes ?? 1_048_576;
  const maxFiles = Math.max(1, options.maxFiles ?? 3);
  const now = options.now ?? (() => new Date());
  const file = (index: number): string => join(options.dir, index === 0 ? 'cashfold.log' : `cashfold.${index}.log`);
  const size = (path: string): number => statSync(path, { throwIfNoEntry: false })?.size ?? 0;

  function rotate(): void {
    rmSync(file(maxFiles - 1), { force: true });
    for (let index = maxFiles - 2; index >= 0; index--) {
      if (statSync(file(index), { throwIfNoEntry: false }) !== undefined) renameSync(file(index), file(index + 1));
    }
  }

  function write(level: Level, event: string, fields?: Record<string, unknown>): void {
    const safeEvent = EVENT.test(event) ? event : 'invalid-event';
    const redacted = fields === undefined ? undefined : redact(fields, options.dataDir);
    const line = `${JSON.stringify({ level, time: now().toISOString(), event: safeEvent, ...(redacted === undefined ? {} : { fields: redacted }) })}\n`;
    try {
      mkdirSync(options.dir, { recursive: true });
      if (size(file(0)) + Buffer.byteLength(line) > maxBytes && size(file(0)) > 0) rotate();
      appendFileSync(file(0), line);
    } catch {
      // Logging must never take the app down.
    }
    if (options.console === true) console.log(line.trimEnd());
  }

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    ipc(channel, outcome) {
      write(outcome === 'ok' ? 'debug' : outcome === 'rejected' ? 'warn' : 'error', 'ipc', { channel: /^cashfold:[a-z:-]+$/.test(channel) ? channel : 'unknown', outcome });
    },
  };
}
