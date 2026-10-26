import { describe, expect, it, vi } from 'vitest';
import { decidePermission, downloadPolicy, isAllowedExternalUrl, lockDownContents } from './security';

describe('which links may be opened outside the app', () => {
  it.each([
    'https://github.com/cashfold/cashfold',
    'https://github.com/cashfold/cashfold/',
    'https://github.com/cashfold/cashfold/releases/tag/v1.2.3',
    'https://github.com/cashfold/cashfold/tree/v1.2.3?plain=1#readme',
  ])('allows %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true);
  });

  it.each([
    ['plain http', 'http://github.com/cashfold/cashfold'],
    ['javascript:', 'javascript:alert(1)'],
    ['file:', 'file:///etc/passwd'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['app:', 'app://cashfold/'],
    ['userinfo', 'https://user:pw@github.com/cashfold/cashfold'],
    ['userinfo that looks like the host', 'https://github.com@evil.example/cashfold/cashfold'],
    ['a look-alike host', 'https://github.com.evil.example/cashfold/cashfold'],
    ['a look-alike prefix', 'https://github.com/cashfold/cashfold-evil'],
    ['another repository', 'https://github.com/other/repo'],
    ['another path', 'https://github.com/cashfold/'],
    ['a port', 'https://github.com:8443/cashfold/cashfold'],
    ['encoded traversal out of the repository', 'https://github.com/cashfold/cashfold/%2e%2e/%2e%2e/evil/repo'],
    ['not a URL', 'github.com/cashfold/cashfold'],
    ['empty', ''],
  ])('refuses %s', (_name, url) => {
    expect(isAllowedExternalUrl(url)).toBe(false);
  });
});

describe('which permissions the page gets', () => {
  const APP = 'app://cashfold';

  it('grants persistent storage and platform authenticators to the app', () => {
    expect(decidePermission('persistent-storage', APP)).toBe(true);
    expect(decidePermission('publickey-credentials-get', APP)).toBe(true);
  });

  it.each(['media', 'geolocation', 'notifications', 'midi', 'pointerLock', 'fullscreen', 'openExternal', 'clipboard-read', 'clipboard-sanitized-write', 'hid', 'serial', 'usb', 'fileSystem', 'unknown', ''])('denies %s', (permission) => {
    expect(decidePermission(permission, APP)).toBe(false);
  });

  it('accepts the app origin with or without the trailing slash the engine sometimes adds', () => {
    expect(decidePermission('persistent-storage', 'app://cashfold/')).toBe(true);
    expect(decidePermission('persistent-storage', 'app://cashfold//')).toBe(false);
    expect(decidePermission('persistent-storage', 'app://cashfold/overview/')).toBe(false);
  });

  it('denies every origin but the app', () => {
    for (const origin of ['https://github.com', 'http://cashfold', 'app://cashfold.evil', 'app://other', 'file://', 'null', '']) {
      expect(decidePermission('persistent-storage', origin), origin).toBe(false);
    }
  });
});

describe('which downloads are saved', () => {
  const BLOB = 'blob:app://cashfold/3f1c2d9e-7a54-4d2c-9e2a-1b6f0c7d8e90';

  it('saves what the app itself made, under the name it suggested', () => {
    expect(downloadPolicy('Household.cashfold-backup', BLOB)).toEqual({ allow: true, filename: 'Household.cashfold-backup' });
    expect(downloadPolicy('transactions.csv', BLOB)).toEqual({ allow: true, filename: 'transactions.csv' });
    expect(downloadPolicy('cashfold-emergency-kit.html', BLOB)).toEqual({ allow: true, filename: 'cashfold-emergency-kit.html' });
    expect(downloadPolicy('receipt.pdf', BLOB)).toEqual({ allow: true, filename: 'receipt.pdf' });
  });

  it('refuses anything the app did not make: another origin, a plain URL, a data URL, an app file', () => {
    for (const url of ['https://github.com/cashfold/cashfold/releases/a.exe', 'blob:https://evil.example/3f1c', 'blob:app://cashfold.evil/x', 'blob:app://other/x', 'data:text/html,hi', 'app://cashfold/sqlite3mc/sqlite3.wasm', 'file:///etc/passwd', '']) {
      expect(downloadPolicy('a.csv', url), url).toEqual({ allow: false });
    }
  });

  it('strips path separators from the suggested name', () => {
    expect(downloadPolicy('../../etc/passwd.cashfold-backup', BLOB)).toEqual({ allow: true, filename: 'passwd.cashfold-backup' });
    expect(downloadPolicy('C:\\Users\\me\\a.csv', BLOB)).toEqual({ allow: true, filename: 'a.csv' });
    expect(downloadPolicy('/tmp/b.csv', BLOB)).toEqual({ allow: true, filename: 'b.csv' });
  });

  it('strips control characters and leading dots', () => {
    expect(downloadPolicy('a\u0000b\nc.csv', BLOB)).toEqual({ allow: true, filename: 'abc.csv' });
    expect(downloadPolicy('...hidden.csv', BLOB)).toEqual({ allow: true, filename: 'hidden.csv' });
  });

  it('names a file that has no usable name', () => {
    for (const name of ['', '.', '...', '/', '\\', '\u0000']) expect(downloadPolicy(name, BLOB), JSON.stringify(name)).toEqual({ allow: true, filename: 'download' });
  });

  it('bounds the length and keeps a short extension', () => {
    const long = downloadPolicy(`${'x'.repeat(500)}.csv`, BLOB);
    expect(long.allow && long.filename.length).toBe(200);
    expect(long.allow && long.filename.endsWith('.csv')).toBe(true);
    const noExtension = downloadPolicy('y'.repeat(500), BLOB);
    expect(noExtension.allow && noExtension.filename.length).toBe(200);
  });

  it('lets the user choose where it goes: the name is only a suggestion', () => {
    // The wiring always shows the native save dialog; the policy never returns a path.
    const decision = downloadPolicy('a.csv', BLOB);
    expect(decision.allow && decision.filename.includes('/')).toBe(false);
  });
});

describe('a page that tries to navigate', () => {
  function navigate(url: string) {
    let handler: (event: { preventDefault(): void }, url: string) => void = () => undefined;
    const log = { warn: vi.fn(), debug: vi.fn() };
    const openExternal = vi.fn(async () => undefined);
    lockDownContents({ on: (name: string, h: typeof handler) => { if (name === 'will-navigate') handler = h; }, setWindowOpenHandler: () => undefined } as never, { openExternal, log });
    const event = { preventDefault: vi.fn() };
    handler(event, url);
    return { event, log, openExternal };
  }

  it('stays put, quietly, when a file is dropped where files are not taken', () => {
    const { event, log, openExternal } = navigate('file:///Users/x/receipt.pdf');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith('security.file-drop-ignored');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('still warns about another site', () => {
    const { event, log } = navigate('https://example.com/');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('security.navigation-blocked');
  });
});
