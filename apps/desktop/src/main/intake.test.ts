import { describe, expect, it, vi } from 'vitest';
import type { IncomingItem } from '@cashfold/platform';
import { classifyArgument, createIntake, MAX_QUEUED, parseLink, readIncomingFile, type FileOps } from './intake';

const link = (raw: string) => parseLink(raw);
const reason = (raw: string) => {
  const result = link(raw);
  return result.ok ? 'accepted' : result.reason;
};

describe('links that are accepted', () => {
  it('opens the add-device screen with the email and the service address, and neither is required', () => {
    expect(link('cashfold://add-device?email=a%40b.example&server=https%3A%2F%2Frelay.example.com')).toEqual({
      ok: true,
      item: { kind: 'link', name: 'add-device', link: { screen: 'add-device', email: 'a@b.example', server: 'https://relay.example.com' } },
    });
    expect(link('cashfold://add-device')).toMatchObject({ ok: true, item: { link: { screen: 'add-device' } } });
    expect(link('cashfold://add-device?email=a@b.example')).toMatchObject({ ok: true, item: { link: { email: 'a@b.example' } } });
  });

  it.each(['overview', 'transactions', 'accounts', 'plan', 'settings'])('opens %s', (target) => {
    expect(link(`cashfold://open/${target}`)).toMatchObject({ ok: true, item: { link: { screen: 'open', target } } });
    expect(link(`cashfold://open/${target}/`)).toMatchObject({ ok: true });
  });

  it('is not case sensitive about the scheme and the host', () => {
    expect(reason('CASHFOLD://Add-Device?email=a@b.example')).toBe('accepted');
  });
});

describe('links that are refused, and why', () => {
  const tooLongServer = `https://relay.example.com/${'a'.repeat(300)}`;
  it.each([
    ['too long (rule 1)', `cashfold://add-device?email=${'a'.repeat(2100)}@b.example`, 'too-long'],
    ['another scheme', 'https://add-device?email=a@b.example', 'scheme'],
    ['an unknown host', 'cashfold://delete-everything', 'host'],
    ['a path after add-device', 'cashfold://add-device/x', 'host'],
    ['a fragment (rule 2)', 'cashfold://add-device?email=a@b.example#abc', 'fragment'],
    ['an empty fragment', 'cashfold://open/plan#', 'fragment'],
    ['user information (rule 2)', 'cashfold://me@add-device?email=a@b.example', 'user-info'],
    ['a port (rule 2)', 'cashfold://add-device:99?email=a@b.example', 'port'],
    ['an unknown parameter (rule 3)', 'cashfold://add-device?email=a@b.example&next=1', 'parameter'],
    ['a parameter on open', 'cashfold://open/plan?email=a@b.example', 'parameter'],
    ['a repeated parameter (rule 3)', 'cashfold://add-device?email=a@b.example&email=c@d.example', 'repeated'],
    ['an email without @ (rule 4)', 'cashfold://add-device?email=nobody', 'email'],
    ['an email with two @ (rule 4)', 'cashfold://add-device?email=a@b@c', 'email'],
    ['an email over 254 characters (rule 4)', `cashfold://add-device?email=${'a'.repeat(250)}@b.example`, 'email'],
    ['a server that is not https (rule 5)', 'cashfold://add-device?server=http%3A%2F%2Frelay.example.com', 'server'],
    ['a server that is not a URL', 'cashfold://add-device?server=relay', 'server'],
    ['a server with user information (rule 5)', 'cashfold://add-device?server=https%3A%2F%2Fme%3Apw%40relay.example.com', 'server'],
    ['a server over 300 characters (rule 5)', `cashfold://add-device?server=${encodeURIComponent(tooLongServer)}`, 'server'],
    ['a control character in a value (rule 7)', 'cashfold://add-device?email=a%0A@b.example', 'control'],
    ['a space in a value', 'cashfold://add-device?email=a%20b@c.example', 'control'],
    ['a double-encoded value (rule 7)', 'cashfold://add-device?email=a%2540b.example', 'encoding'],
    ['a broken encoding', 'cashfold://add-device?email=%E0%A4%A@b.example', 'encoding'],
    ['an unknown open target', 'cashfold://open/delete', 'target'],
    ['open with no target', 'cashfold://open', 'target'],
  ] as const)('%s', (_name, raw, expected) => expect(reason(raw)).toBe(expected));

  it.each([
    'cashfold://add-device?secretKey=abc',
    'cashfold://add-device?Password=abc',
    'cashfold://add-device?recovery=abc',
    'cashfold://add-device?token=abc',
    'cashfold://add-device?apikey=abc',
    'cashfold://add-device?%73ecret=abc',
  ])('refuses a parameter named like a secret: %s (rule 6)', (raw) => expect(reason(raw)).toBe('secret'));

  it.each([
    'cashfold://add-device?email=a@b.example&server=https://relay.example.com/C1-ABCDEF-123456',
    'cashfold://add-device?email=R1-ABCD-EFGH@b.example',
    'cashfold://open/plan/C1-AAAA',
    'cashfold://add-device?email=a%40b.example&server=https%3A%2F%2Fx.example%2Fc1-abcd',
  ])('refuses a Secret Key or Recovery Key anywhere in the link: %s (rule 6)', (raw) => expect(reason(raw)).toBe('secret'));

  it('says that it is refused and nothing else: the value is not in the result', () => {
    const result = link('cashfold://add-device?secretKey=C1-AAAA-BBBB');
    expect(result).toEqual({ ok: false, reason: 'secret' });
    expect(JSON.stringify(result)).not.toContain('AAAA');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------

function fileOps(over: { isFile?: boolean; size?: number; content?: string; openFails?: boolean; readSizes?: number[] } = {}): FileOps & { reads: number[]; closed: boolean } {
  const content = new TextEncoder().encode(over.content ?? 'a,b\n1,2\n');
  const size = over.size ?? content.byteLength;
  const state = { reads: [] as number[], closed: false };
  return {
    open: () => {
      if (over.openFails) throw new Error('ENOENT');
      return 7;
    },
    stat: () => ({ isFile: () => over.isFile ?? true, size }),
    read: (_fd, buffer, offset, length) => {
      state.reads.push(length);
      const chunk = over.readSizes?.[state.reads.length - 1] ?? length;
      const got = Math.min(chunk, content.byteLength - offset, length);
      buffer.set(content.subarray(offset, offset + got), offset);
      return got;
    },
    close: () => void (state.closed = true),
    get reads() {
      return state.reads;
    },
    get closed() {
      return state.closed;
    },
  };
}
const MIB = 1024 * 1024;

describe('files opened from the file manager', () => {
  it('reads a CSV and a backup that are regular files within their limits, and gives the page the name only', () => {
    expect(readIncomingFile('/Users/x/Downloads/bank.CSV', fileOps())).toMatchObject({ ok: true, item: { kind: 'csv', name: 'bank.CSV' } });
    expect(readIncomingFile('/tmp/Household.cashfold-backup', fileOps({ content: 'backup' }))).toMatchObject({ ok: true, item: { kind: 'backup', name: 'Household.cashfold-backup' } });
    const result = readIncomingFile('/Users/x/secret-folder/bank.csv', fileOps());
    expect(JSON.stringify(result)).not.toContain('secret-folder');
  });

  it('refuses another extension before it opens anything', () => {
    const ops = fileOps();
    const open = vi.spyOn(ops, 'open');
    expect(readIncomingFile('/tmp/photo.png', ops)).toEqual({ ok: false, reason: 'extension' });
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses a directory, a device and a pipe (anything that is not a regular file on the open descriptor), without reading', () => {
    const ops = fileOps({ isFile: false });
    expect(readIncomingFile('/dev/zero.csv', ops)).toEqual({ ok: false, reason: 'not-regular' });
    expect(ops.reads).toEqual([]);
    expect(ops.closed).toBe(true);
  });

  it('refuses an empty file, and a file over its limit, before reading a byte', () => {
    for (const [size, path, expected] of [
      [0, '/tmp/a.csv', 'empty'],
      [16 * MIB + 1, '/tmp/a.csv', 'too-large'],
      [128 * MIB + 1, '/tmp/a.cashfold-backup', 'too-large'],
    ] as const) {
      const ops = fileOps({ size });
      expect(readIncomingFile(path, ops), path).toEqual({ ok: false, reason: expected });
      expect(ops.reads).toEqual([]);
    }
  });

  it('allows exactly the limit', () => {
    const ops = fileOps({ size: 16 * MIB, content: 'x' });
    expect(readIncomingFile('/tmp/a.csv', ops)).toMatchObject({ ok: true });
  });

  it('allows a bigger backup than a CSV', () => {
    expect(readIncomingFile('/tmp/a.cashfold-backup', fileOps({ size: 100 * MIB, content: 'x' }))).toMatchObject({ ok: true });
    expect(readIncomingFile('/tmp/a.csv', fileOps({ size: 100 * MIB }))).toEqual({ ok: false, reason: 'too-large' });
  });

  it('refuses a name longer than the page accepts, and a file that cannot be opened', () => {
    expect(readIncomingFile(`/tmp/${'a'.repeat(120)}.csv`, fileOps())).toEqual({ ok: false, reason: 'name-too-long' });
    expect(readIncomingFile('/tmp/gone.csv', fileOps({ openFails: true }))).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('reads in as many pieces as the system gives, and closes the descriptor', () => {
    const ops = fileOps({ content: 'abcdef', readSizes: [2, 2, 2] });
    const result = readIncomingFile('/tmp/a.csv', ops);
    expect(result.ok && new TextDecoder().decode(result.item.bytes)).toBe('abcdef');
    expect(ops.closed).toBe(true);
  });

  it('keeps what was read when the file shrank while it was being read', () => {
    const ops = fileOps({ content: 'abc', size: 10, readSizes: [3, 0] });
    const result = readIncomingFile('/tmp/a.csv', ops);
    expect(result.ok && result.item.bytes.byteLength).toBe(3);
  });

  it('opens a real file, the way the app does', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'cashfold-intake-'));
    writeFileSync(join(dir, 'bank.csv'), 'date,amount\n2025-01-01,-3\n');
    mkdirSync(join(dir, 'folder.csv'));
    expect(readIncomingFile(join(dir, 'bank.csv'))).toMatchObject({ ok: true, item: { kind: 'csv', name: 'bank.csv' } });
    expect(readIncomingFile(join(dir, 'folder.csv'))).toEqual({ ok: false, reason: 'not-regular' });
    expect(readIncomingFile(join(dir, 'nothing.csv'))).toEqual({ ok: false, reason: 'unreadable' });
  });
});

describe('the arguments of a launch', () => {
  it.each([
    ['cashfold://open/plan', 'link'],
    ['CASHFOLD://add-device', 'link'],
    ['/tmp/bank.csv', 'file'],
    ['C:\\Users\\x\\Household.cashfold-backup', 'file'],
    ['--hidden', 'ignore'],
    ['--action=lock', 'ignore'],
    ['/usr/bin/cashfold', 'ignore'],
    ['--flag.csv', 'ignore'],
    ['notes.txt', 'ignore'],
  ])('%s is %s', (argument, expected) => expect(classifyArgument(argument)).toBe(expected));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------

function setup(over: { reported?: boolean; unlocked?: boolean; files?: Record<string, ReturnType<typeof readIncomingFile>> } = {}) {
  const state = { reported: over.reported ?? true, unlocked: over.unlocked ?? false, hasWindow: true };
  const sent: IncomingItem[] = [];
  const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  const csv = (name: string, size = 3): ReturnType<typeof readIncomingFile> => ({ ok: true, item: { kind: 'csv', name, bytes: new Uint8Array(size) } });
  const intake = createIntake({
    send: (item) => (state.hasWindow ? (sent.push(item), true) : false),
    pageReported: () => state.reported,
    unlocked: () => state.unlocked,
    log: { info: (event, fields) => void logs.push({ event, ...(fields === undefined ? {} : { fields }) }) },
    readFile: (path) => over.files?.[path] ?? csv(path.split('/').pop()!),
  });
  return { intake, state, sent, logs, csv };
}

describe('the queue', () => {
  it('holds file contents while the page is locked, and delivers them in order once it reports unlocked', () => {
    const { intake, state, sent } = setup();
    intake.accept('/tmp/a.csv');
    intake.accept('/tmp/b.csv');
    expect(sent).toEqual([]);
    expect(intake.queued()).toBe(2);
    state.unlocked = true;
    intake.flush();
    expect(sent.map((i) => (i.kind === 'csv' ? i.name : i.kind))).toEqual(['a.csv', 'b.csv']);
    expect(intake.queued()).toBe(0);
  });

  it('delivers a link at once, because it carries no content, but never a file to a locked page', () => {
    const { intake, sent } = setup();
    intake.accept('cashfold://open/plan');
    intake.accept('/tmp/a.csv');
    expect(sent.map((i) => i.kind)).toEqual(['link']);
    expect(intake.queued()).toBe(1);
  });

  it('holds a link until the page has loaded and can show it', () => {
    const { intake, state, sent } = setup({ reported: false });
    intake.accept('cashfold://open/plan');
    expect(sent).toEqual([]);
    state.reported = true;
    intake.flush();
    expect(sent.map((i) => i.kind)).toEqual(['link']);
  });

  it('tells the page why an item was refused, with a reason code and nothing from the item', () => {
    const { intake, sent } = setup();
    intake.accept('cashfold://add-device?secretKey=C1-AAAA-BBBB');
    expect(sent).toEqual([{ kind: 'refused', reason: 'secret' }]);
    expect(JSON.stringify(sent)).not.toContain('AAAA');
  });

  it('takes at most eight, and tells the page when the oldest had to go', () => {
    const { intake, state, sent, logs } = setup();
    for (let i = 0; i < MAX_QUEUED + 1; i++) intake.accept(`/tmp/f${i}.csv`);
    expect(intake.queued()).toBe(MAX_QUEUED);
    expect(sent).toEqual([{ kind: 'refused', reason: 'queue-full' }]);
    expect(logs.some((l) => l.fields?.['reason'] === 'queue-full')).toBe(true);
    state.unlocked = true;
    intake.flush();
    const names = sent.filter((i) => i.kind === 'csv').map((i) => (i.kind === 'csv' ? i.name : ''));
    expect(names).toEqual(['f1.csv', 'f2.csv', 'f3.csv', 'f4.csv', 'f5.csv', 'f6.csv', 'f7.csv', 'f8.csv']);
  });

  it('refuses a file when the bytes held for a locked page would pass the cap', () => {
    const heavy = (name: string): ReturnType<typeof readIncomingFile> => ({ ok: true, item: { kind: 'backup', name, bytes: { byteLength: 200 * MIB } as unknown as Uint8Array<ArrayBuffer> } });
    const { intake, sent } = setup({ files: { '/tmp/a.cashfold-backup': heavy('a.cashfold-backup'), '/tmp/b.cashfold-backup': heavy('b.cashfold-backup') } });
    intake.accept('/tmp/a.cashfold-backup');
    intake.accept('/tmp/b.cashfold-backup');
    expect(intake.queued()).toBe(1);
    expect(sent).toEqual([{ kind: 'refused', reason: 'queue-full' }]);
  });

  it('keeps an item when there is no window to send it to, and sends it when there is', () => {
    const { intake, state, sent } = setup();
    state.hasWindow = false;
    intake.accept('cashfold://open/plan');
    expect(intake.queued()).toBe(1);
    state.hasWindow = true;
    intake.flush();
    expect(sent).toHaveLength(1);
  });

  it('ignores an argument that is not ours, and forgets everything on clear (quit)', () => {
    const { intake, sent } = setup();
    intake.accept('--hidden');
    intake.accept('/tmp/a.csv');
    intake.clear();
    expect(intake.queued()).toBe(0);
    expect(sent).toEqual([]);
  });

  it('logs the kind, the decision and the reason code only, never a link or a path', () => {
    const { intake, logs } = setup();
    intake.accept('cashfold://add-device?email=person%40private.example&server=https%3A%2F%2Frelay.example.com');
    intake.accept('cashfold://add-device?token=hunter2');
    intake.accept('/Users/private-person/bank.csv');
    const text = JSON.stringify(logs);
    expect(text).not.toMatch(/private|hunter2|relay\.example|bank\.csv|Users/);
    expect(logs.map((l) => [l.fields?.['kind'], l.fields?.['decision']])).toEqual([['link', 'accepted'], ['link', 'refused'], ['csv', 'accepted']]);
  });
});
