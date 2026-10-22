import { containsAmount, containsBytes, encodings, formatLeaks, scanForLeaks, startCapture, type Seed } from './fixtures/leak-scan.js';
import { parsePrefs } from '../apps/web/src/ui/prefs/schema.js';
import { expect, test } from './fixtures/index.js';

// The scan must be able to fail. Each case plants one marker in one place and checks it is reported; the clean
// case checks nothing is reported when nothing leaked.

const seed: Seed = { strings: ['Mum\'s birthday gift', 'Alice Example', 'Secret Savings'], amounts: ['12.50', '1250'] };
const HOST = 'http://leak-selftest.localhost';

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'the self-test page relies on *.localhost being a secure context');
  await page.route(`${HOST}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>t</title><body>ok</body>' }));
  await page.goto(`${HOST}/`);
});

test('a clean page has no leaks', async ({ page }) => {
  const capture = startCapture(page);
  await page.evaluate(() => console.log('app.started', 3));
  expect(await scanForLeaks(page, { seed, capture })).toEqual([]);
});

test('finds a marker in an OPFS file (UTF-8 and UTF-16)', async ({ page }) => {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const a = await (await root.getFileHandle('a.bin', { create: true })).createWritable();
    await a.write(new TextEncoder().encode('xx Alice Example yy'));
    await a.close();
    const b = await (await root.getFileHandle('b.bin', { create: true })).createWritable();
    const s = 'Secret Savings';
    const u16 = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) { u16[i * 2] = s.charCodeAt(i); u16[i * 2 + 1] = 0; }
    await b.write(u16);
    await b.close();
  });
  const leaks = await scanForLeaks(page, { seed });
  expect(leaks.map((l) => `${l.where}:${l.marker}`).sort()).toEqual(['opfs:Alice Example', 'opfs:Secret Savings']);
});

test('finds a marker in IndexedDB, localStorage, sessionStorage and Cache Storage', async ({ page }) => {
  await page.evaluate(async () => {
    await new Promise<void>((res, rej) => {
      const req = indexedDB.open('leaky', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('rows', { autoIncrement: true });
      req.onsuccess = () => {
        const tx = req.result.transaction('rows', 'readwrite');
        tx.objectStore('rows').add({ note: "Mum's birthday gift" });
        tx.oncomplete = () => { req.result.close(); res(); };
      };
      req.onerror = () => rej(req.error);
    });
    localStorage.setItem('draft', 'paid 12.50 to someone');
    sessionStorage.setItem('x', 'Alice Example');
    const cache = await caches.open('c');
    await cache.put('/page', new Response('Secret Savings', { headers: { 'content-type': 'text/html' } }));
  });
  const leaks = await scanForLeaks(page, { seed });
  // The `draft` key is both seeded text and a key the app may not use.
  expect(leaks.map((l) => l.where).sort()).toEqual(['cachestorage', 'indexeddb', 'localstorage', 'localstorage', 'sessionstorage']);
});

test('allows only a schema-valid cashfold.ui in localStorage', async ({ page }) => {
  const valid = JSON.stringify(parsePrefs(JSON.stringify({ v: 1, theme: 'dark', recents: { account: { f1: 'a1' }, categories: {} } })));
  await page.evaluate((v) => localStorage.setItem('cashfold.ui', v), valid);
  expect(await scanForLeaks(page, { seed })).toEqual([]);

  await page.evaluate(() => localStorage.setItem('cashfold.ui', JSON.stringify({ v: 1, theme: 'dark', extra: 'x' })));
  expect(formatLeaks(await scanForLeaks(page, { seed }))).toMatch(/does not match the preferences schema/);

  await page.evaluate(() => localStorage.setItem('cashfold.ui', JSON.stringify({ v: 1, hints: { dismissed: ['Alice Example'] } })));
  expect(formatLeaks(await scanForLeaks(page, { seed }))).toMatch(/localstorage: "Alice Example"/);
});

test('reports any other localStorage key', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  expect(formatLeaks(await scanForLeaks(page, { seed }))).toMatch(/unexpected localStorage key "theme"/);
});

test('finds a marker in the console and in a network request', async ({ page }) => {
  const capture = startCapture(page);
  await page.route(`${HOST}/api`, (route) => route.fulfill({ status: 204 }));
  await page.evaluate(async () => {
    console.log('saved note Alice Example');
    await fetch('/api', { method: 'POST', body: JSON.stringify({ memo: '1250' }) });
  });
  const leaks = await scanForLeaks(page, { seed, capture });
  expect(formatLeaks(leaks)).toMatch(/console: "Alice Example"/);
  expect(formatLeaks(leaks)).toMatch(/network: "1250"/);
});

test('finds a marker in the page URL', async ({ page }) => {
  await page.goto(`${HOST}/?note=Alice%20Example#Secret Savings`);
  const leaks = await scanForLeaks(page, { seed: { strings: ['Secret Savings'], amounts: [] } });
  expect(leaks.map((l) => l.where)).toContain('url');
});

test('matching helpers: whole-number amounts, byte search, encodings', () => {
  expect(containsAmount('paid 12.50 today', '12.50')).toBe(true);
  expect(containsAmount('id 1250', '12.50')).toBe(false);
  expect(containsAmount('total 1250.', '1250')).toBe(true);
  expect(containsAmount('number 912501', '1250')).toBe(false);
  expect(containsAmount('1250', '1250')).toBe(true);
  expect(containsAmount('12.50', '12')).toBe(false);
  expect(containsAmount('1,250.00', '250')).toBe(false);
  expect(containsAmount('see 12, then 5', '12')).toBe(true);
  expect(containsBytes(Uint8Array.of(1, 2, 3, 4), Uint8Array.of(2, 3))).toBe(true);
  expect(containsBytes(Uint8Array.of(1, 2, 3, 4), Uint8Array.of(3, 5))).toBe(false);
  expect(containsBytes(Uint8Array.of(1), new Uint8Array(0))).toBe(false);
  expect(encodings('a').map((e) => Array.from(e))).toEqual([[97], [97, 0], [0, 97]]);
});
