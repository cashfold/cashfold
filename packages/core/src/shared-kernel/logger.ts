import type { Id } from './id.js';

// Structured logging that cannot leak content (FR-016, FR-098). Three layers:
//  1. Types: field values are numbers, booleans, ids, literals and `Redacted`; a free `string` does not compile.
//  2. Event names are static identifiers, never interpolated text.
//  3. At runtime every value is sanitised again, because JavaScript callers can bypass types: bigint (money),
//     bytes, secret holders, errors' messages, sensitive field names and secret-shaped strings never reach the sink.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

declare const literalBrand: unique symbol;
/** A string that appears literally in the source. Create with `lit('pull')`; computed strings do not type-check. */
export type Literal = string & { readonly [literalBrand]: true };

export const lit = <S extends string>(value: string extends S ? never : S): S & Literal => value as unknown as S & Literal;

/** Marks a value as sensitive: it prints as `[redacted]` everywhere. */
export class Redacted<T = unknown> {
  readonly #value: T;
  constructor(value: T) {
    this.#value = value;
  }
  reveal(): T {
    return this.#value;
  }
  toString(): string {
    return '[redacted]';
  }
  toJSON(): string {
    return '[redacted]';
  }
}

export const redacted = <T>(value: T): Redacted<T> => new Redacted(value);

export type LogValue = number | boolean | null | undefined | Id | Literal | Redacted | readonly LogValue[] | { readonly [key: string]: LogValue };
export type LogFields = { readonly [key: string]: LogValue };

export interface LogEntry {
  readonly level: LogLevel;
  readonly event: string;
  readonly atMs: number;
  readonly fields: { readonly [key: string]: unknown };
}

export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const ORDER: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };
const EVENT = /^[a-z][a-z0-9_.]{0,63}$/;
const REDACTED = '[redacted]';
const MAX_DEPTH = 3;
const MAX_ITEMS = 20;
const MAX_TEXT = 80;

const SENSITIVE_NAME = /(pass(word|phrase)?|secret|token|authori[sz]ation|\bauth\b|amount|balance|note|memo|payee|account.?name|category|email|address|private|^sk$|mnemonic|iban|description|recovery|credential|cookie|key)/i;

const SECRET_SHAPES: readonly RegExp[] = [
  /^C\d-[A-Z2-9]{6}(-[A-Z2-9]{6}){3,}/, // Secret Key
  /^[0-9a-f]{32,}$/i, // long hex: keys, hashes, blobs
  /^[A-Za-z0-9+/_-]{40,}={0,2}$/, // long base64 / base64url
  /^\d[\d -]{12,}\d$/, // card-like digit runs
  /^eyJ/, // JWT-like
  /@/, // anything that looks like an email address
];

function sanitiseText(text: string): string {
  if (SECRET_SHAPES.some((re) => re.test(text))) return REDACTED;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

function sanitise(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  switch (typeof value) {
    case 'number':
      return Number.isFinite(value) ? value : 'non_finite';
    case 'boolean':
    case 'undefined':
      return value;
    case 'string':
      return sanitiseText(value);
    case 'object':
      break;
    default:
      return REDACTED; // bigint, symbol, function
  }
  if (value === null) return null;
  if (value instanceof Redacted || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return REDACTED;
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return { name: value.name, ...(typeof code === 'string' ? { code: sanitiseText(code) } : {}) };
  }
  if (value instanceof Map || value instanceof Set || value instanceof Date || value instanceof Promise) return REDACTED;
  const asRecord = value as Record<string, unknown>;
  if (typeof asRecord['use'] === 'function' || typeof asRecord['wipe'] === 'function') return REDACTED; // secret holder
  if (seen.has(value)) return '[cycle]';
  if (depth >= MAX_DEPTH) return '[depth]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => sanitise(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value).slice(0, MAX_ITEMS)) out[k] = SENSITIVE_NAME.test(k) ? REDACTED : sanitise(v, depth + 1, seen);
  return out;
}

function sanitiseFields(fields: LogFields | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields === undefined) return out;
  const seen = new WeakSet<object>();
  for (const [k, v] of Object.entries(fields).slice(0, MAX_ITEMS)) out[k] = SENSITIVE_NAME.test(k) ? REDACTED : sanitise(v, 1, seen);
  return out;
}

export interface LoggerOptions {
  readonly sink: LogSink;
  readonly minLevel?: LogLevel;
  readonly nowMs?: () => number;
}

export function createLogger(options: LoggerOptions, context: Record<string, unknown> = {}): Logger {
  const min = ORDER[options.minLevel ?? 'debug'];
  const now = options.nowMs ?? (() => Date.now());

  const write = (level: LogLevel, event: string, fields?: LogFields): void => {
    if (ORDER[level] < min) return;
    try {
      options.sink({
        level,
        event: EVENT.test(event) ? event : 'invalid_event',
        atMs: now(),
        fields: { ...context, ...sanitiseFields(fields) },
      });
    } catch {
      // Logging must never break the code being logged, and a failing sink must not leak through an exception.
    }
  };

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    child: (fields) => createLogger(options, { ...context, ...sanitiseFields(fields) }),
  };
}
