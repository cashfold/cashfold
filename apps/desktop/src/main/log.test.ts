import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './log';

let dir: string;
let dataDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'logs-'));
  dataDir = '/Users/someone/Library/Application Support/Cashfold';
});

const make = (options: Partial<Parameters<typeof createLogger>[0]> = {}) => createLogger({ dir, dataDir, now: () => new Date('2026-10-22T10:00:00.000Z'), ...options });
const lines = (file = 'cashfold.log') => readFileSync(join(dir, file), 'utf8').trimEnd().split('\n');

describe('structured lines', () => {
  it('writes one JSON object per line with level, time and event', () => {
    const log = make();
    log.info('app.start', { version: '1.2.3' });
    log.warn('update.check', { outcome: 'offline' });
    log.error('window.crash');
    const parsed = lines().map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed).toEqual([
      { level: 'info', time: '2026-10-22T10:00:00.000Z', event: 'app.start', fields: { version: '1.2.3' } },
      { level: 'warn', time: '2026-10-22T10:00:00.000Z', event: 'update.check', fields: { outcome: 'offline' } },
      { level: 'error', time: '2026-10-22T10:00:00.000Z', event: 'window.crash' },
    ]);
  });

  it('creates the log folder', () => {
    const nested = join(dir, 'a', 'b');
    createLogger({ dir: nested, dataDir }).info('app.start');
    expect(readdirSync(nested)).toEqual(['cashfold.log']);
  });

  it('keeps an event name to a safe vocabulary, so a caller cannot forge lines', () => {
    const log = make();
    log.info('bad name\n{"level":"error"}');
    expect(lines()).toHaveLength(1);
    expect((JSON.parse(lines()[0]!) as { event: string }).event).toBe('invalid-event');
  });

  it('keeps a newline in a value inside the one line', () => {
    make().info('app.start', { note: 'a\nb\r\nc' });
    expect(lines()).toHaveLength(1);
  });

  it('never throws when it cannot write', () => {
    const log = createLogger({ dir: join(dir, 'x'), dataDir });
    writeFileSync(join(dir, 'x'), 'a file where the folder should be');
    expect(() => log.info('app.start')).not.toThrow();
  });

  it('writes to the console only when asked to (development), never in a packaged build', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    make().info('app.start');
    expect(spy).not.toHaveBeenCalled();
    make({ console: true }).info('app.start');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('redaction by type', () => {
  const text = () => readFileSync(join(dir, 'cashfold.log'), 'utf8');

  it('replaces the user-data folder wherever it appears', () => {
    const log = make();
    log.info('storage.open', { path: `${dataDir}/Default/File System/000`, note: `failed in ${dataDir}` });
    expect(text()).not.toContain('Application Support');
    expect(text()).toContain('[data-dir]');
  });

  it('hides values under keys that name a secret', () => {
    const log = make();
    log.info('auth', { passphrase: 'hunter2', password: 'hunter3', secretKey: 'A3-XXXXXX', token: 'abc123', authorization: 'Bearer zzz', cookie: 'sid=1', apiKey: 'k' });
    for (const secret of ['hunter2', 'hunter3', 'A3-XXXXXX', 'abc123', 'Bearer zzz', 'sid=1']) expect(text(), secret).not.toContain(secret);
  });

  it('hides key-shaped strings: hex and base64 of 32 bytes or more', () => {
    const log = make();
    const hex = 'ab'.repeat(32);
    const b64 = Buffer.alloc(32, 7).toString('base64');
    const b64url = Buffer.alloc(48, 9).toString('base64url');
    log.info('x', { hex, b64, b64url, short: 'abc123' });
    expect(text()).not.toContain(hex);
    expect(text()).not.toContain(b64);
    expect(text()).not.toContain(b64url);
    expect(text()).toContain('abc123');
  });

  it('removes credentials from URLs', () => {
    const log = make();
    log.info('net', { url: 'https://user:pw@example.com/path?token=abc&x=1&api_key=def#frag', other: 'https://example.com/ok' });
    const out = text();
    for (const secret of ['user', 'pw', 'abc', 'def']) expect(out, secret).not.toContain(secret.length > 2 ? secret : `:${secret}@`);
    expect(out).toContain('https://example.com/ok');
  });

  it('describes bytes by length, never by content', () => {
    const log = make();
    log.info('blob', { data: new Uint8Array([1, 2, 3]), buf: Buffer.from('secret-bytes') });
    const [entry] = lines().map((l) => JSON.parse(l) as { fields: Record<string, unknown> });
    expect(entry?.fields).toEqual({ data: '[bytes 3]', buf: '[bytes 12]' });
  });

  it('redacts inside nested objects and arrays, and bounds the depth', () => {
    const log = make();
    log.info('deep', { a: { b: { passphrase: 'nested-secret', c: [{ token: 'in-array' }] } }, d: { e: { f: { g: { h: { i: 1 } } } } } });
    expect(text()).not.toContain('nested-secret');
    expect(text()).not.toContain('in-array');
    expect(text()).toContain('[depth]');
  });

  it('logs an error by name and redacted message, without a stack', () => {
    const log = make();
    log.error('crash', { error: new Error(`could not open ${dataDir}/db`) });
    const out = text();
    expect(out).not.toContain('Application Support');
    expect(out).not.toContain(' at ');
    expect(out).toContain('"name":"Error"');
  });

  it('records only the channel and outcome of an IPC call, never its payload', () => {
    const log = make();
    (log.ipc as (channel: string, outcome: string, payload?: unknown) => void)('cashfold:update:download', 'ok', { secret: 'payload-content' });
    log.ipc('cashfold:about', 'rejected');
    const out = text();
    expect(out).not.toContain('payload-content');
    expect(lines().map((l) => JSON.parse(l) as { event: string; fields: unknown })).toEqual([
      { level: 'debug', time: '2026-10-22T10:00:00.000Z', event: 'ipc', fields: { channel: 'cashfold:update:download', outcome: 'ok' } },
      { level: 'warn', time: '2026-10-22T10:00:00.000Z', event: 'ipc', fields: { channel: 'cashfold:about', outcome: 'rejected' } },
    ]);
  });
});

describe('rotation', () => {
  it('starts a new file when the current one would pass the size limit, keeping a few old ones', () => {
    const log = make({ maxBytes: 400, maxFiles: 3 });
    for (let i = 0; i < 40; i++) log.info('tick', { i });
    const names = readdirSync(dir).sort();
    expect(names).toEqual(['cashfold.1.log', 'cashfold.2.log', 'cashfold.log']);
    for (const name of names) expect(readFileSync(join(dir, name)).length).toBeLessThanOrEqual(400);
  });

  it('keeps the newest lines in the current file', () => {
    const log = make({ maxBytes: 400, maxFiles: 2 });
    for (let i = 0; i < 40; i++) log.info('tick', { i });
    const last = JSON.parse(lines().at(-1)!) as { fields: { i: number } };
    expect(last.fields.i).toBe(39);
  });
});
