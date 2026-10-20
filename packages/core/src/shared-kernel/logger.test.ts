import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createLogger, lit, redacted, type LogEntry } from './logger';
import type { Id } from './id';

const collect = () => {
  const entries: LogEntry[] = [];
  return { entries, sink: (e: LogEntry) => void entries.push(e) };
};
const dump = (entries: LogEntry[]) => JSON.stringify(entries, (_k, v) => (typeof v === 'bigint' ? `BIGINT:${v}` : v));
const uuid = '018bcfe5-6800-7b69-8384-6c668fbade60' as Id;

describe('what a log entry is', () => {
  it('has a static event name, a level, a timestamp and redacted fields', () => {
    const { entries, sink } = collect();
    const log = createLogger({ sink, nowMs: () => 1234 });
    log.info('sync.pull.done', { ops: 12, more: false, fold: uuid, phase: lit('pull') });
    expect(entries).toEqual([{ level: 'info', event: 'sync.pull.done', atMs: 1234, fields: { ops: 12, more: false, fold: uuid, phase: 'pull' } }]);
  });

  it('refuses event names that could carry content: they become invalid_event', () => {
    const { entries, sink } = collect();
    const log = createLogger({ sink });
    for (const bad of ['paid 12.50 to Alice', 'Sync Done', 'x'.repeat(100), '', 'a-b', `balance=${5n}`]) log.info(bad);
    expect(entries.map((e) => e.event)).toEqual(Array(6).fill('invalid_event'));
  });

  it('filters by level', () => {
    const { entries, sink } = collect();
    const log = createLogger({ sink, minLevel: 'warn' });
    log.debug('a.b');
    log.info('a.b');
    log.warn('a.b');
    log.error('a.b');
    expect(entries.map((e) => e.level)).toEqual(['warn', 'error']);
  });
});

describe('redaction by value type', () => {
  it('never prints bigint (money), bytes or secret holders', () => {
    const { entries, sink } = collect();
    const log = createLogger({ sink });
    log.info('x.y', {
      cents: 123456789012345678n,
      blob: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      buffer: new ArrayBuffer(8),
      holder: redacted({ secret: 'hunter2' }),
      nested: { list: [987654321098765432n, new Uint8Array(3)] },
    } as never);
    const out = dump(entries);
    expect(out).not.toMatch(/123456789012345678|987654321098765432|222,173|hunter2|dead/i);
    expect(out).toContain('[redacted]');
  });

  it('redacts objects that hold secrets by shape: anything with a use() method, or a toJSON that throws', () => {
    const { entries, sink } = collect();
    const log = createLogger({ sink });
    const secretLike = { use: () => 1, wipe: () => undefined, hidden: 'x' };
    log.info('x.y', { key: secretLike } as never);
    expect(dump(entries)).not.toContain('hidden');
  });

  it('reduces errors to their name and code, never the message', () => {
    const { entries, sink } = collect();
    const log = createLogger({ sink });
    const e = Object.assign(new Error('INSERT INTO txn VALUES (12.50, "Alice")'), { code: 'sqlite_constraint' });
    log.error('db.write_failed', { error: e } as never);
    const out = dump(entries);
    expect(out).toContain('sqlite_constraint');
    expect(out).toContain('Error');
    expect(out).not.toMatch(/INSERT|Alice|12\.50/);
  });
});

describe('redaction by field name and by shape (defence in depth for dynamic callers)', () => {
  it.each(['password', 'newPassword', 'secretKey', 'secret_key', 'recoveryKey', 'token', 'authorization', 'amount_minor', 'balance', 'note', 'memo', 'payeeName', 'accountName', 'category', 'email', 'address', 'privateKey', 'sk', 'passphrase', 'mnemonic', 'iban', 'description'])(
    'hides the value of a field called %s',
    (name) => {
      const { entries, sink } = collect();
      createLogger({ sink }).info('x.y', { [name]: 'visible-if-bug' } as never);
      expect(dump(entries)).not.toContain('visible-if-bug');
    },
  );

  it('hides anything shaped like a Secret Key, a long hex/base64 string or a card-like number', () => {
    const { entries, sink } = collect();
    createLogger({ sink }).info('x.y', {
      a: 'C1-ABCDEF-GHJKLM-NPQRST-UVWXYZ-234567-ABCDEF',
      b: 'a'.repeat(64),
      c: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5',
      d: '4111 1111 1111 1111',
    } as never);
    expect(dump(entries)).not.toMatch(/ABCDEF|aaaaaaaa|QUJD|4111/);
  });

  it('truncates long free text and caps nesting depth', () => {
    const { entries, sink } = collect();
    let deep: Record<string, unknown> = { leaf: 'bottom' };
    for (let i = 0; i < 20; i++) deep = { inner: deep };
    createLogger({ sink }).info('x.y', { text: 'word '.repeat(200), deep } as never);
    const out = dump(entries);
    expect(out.length).toBeLessThan(1500);
    expect(out).not.toContain('bottom');
  });

  it('survives cyclic structures', () => {
    const { entries, sink } = collect();
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => createLogger({ sink }).info('x.y', { a } as never)).not.toThrow();
    expect(entries).toHaveLength(1);
  });
});

describe('property: secrets placed anywhere in a log call never reach the sink', () => {
  const secret = fc.string({ minLength: 8, maxLength: 24, unit: fc.constantFrom(...'QWXZqwxz0123456789') }).map((s) => `SECRET${s}`);
  const key = fc.constantFrom('detail', 'value', 'x', 'info', 'payload', 'ctx');

  it('bigint, bytes, redacted wrappers and secret-named fields are hidden for any key and nesting', () => {
    fc.assert(
      fc.property(secret, key, fc.constantFrom('password', 'note', 'secretKey', 'amount_minor', 'email'), fc.bigInt({ min: 10n ** 12n, max: 10n ** 18n }), (s, neutral, sensitive, amount) => {
        const { entries, sink } = collect();
        const bytes = new TextEncoder().encode(s);
        createLogger({ sink }).warn('x.y', {
          [neutral]: { deeper: [amount, bytes, redacted(s)] },
          [sensitive]: s,
        } as never);
        const out = dump(entries);
        expect(out).not.toContain(s);
        expect(out).not.toContain(amount.toString());
        expect(out).not.toContain(Array.from(bytes).join(','));
      }),
    );
  });
});

describe('robustness and context', () => {
  it('never throws, even if the sink does', () => {
    const log = createLogger({ sink: () => { throw new Error('sink down'); } });
    expect(() => log.error('x.y', { a: 1 })).not.toThrow();
  });

  it('child loggers add context that is redacted the same way', () => {
    const { entries, sink } = collect();
    const log = createLogger({ sink }).child({ component: lit('sync'), password: 'leaky' } as never);
    log.info('x.y', { n: 1 });
    expect(entries[0]!.fields).toMatchObject({ component: 'sync', n: 1 });
    expect(dump(entries)).not.toContain('leaky');
  });

  it('does not let a field named like an envelope key overwrite the event or level', () => {
    const { entries, sink } = collect();
    createLogger({ sink }).info('x.y', { event: lit('forged'), level: lit('error') } as never);
    expect(entries[0]).toMatchObject({ event: 'x.y', level: 'info' });
  });
});
