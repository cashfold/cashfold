import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go } from './fixtures/nav.js';

// What the static export promises the browser (Constitution VIII, T189): a Content-Security-Policy with no 'unsafe-inline' or
// 'unsafe-eval', a subresource-integrity hash on every script and stylesheet, a no-referrer policy, the headers a host must send,
// and a service worker that pins exactly the files it was built with. The first group checks the built files; the second runs the
// app under that policy and fails on any violation, and shows that a changed script does not run.

const out = new URL('../apps/web/out/', import.meta.url).pathname;
const PASSWORD = 'correct horse battery staple';
const RELAY = `http://localhost:${Number(process.env['E2E_RELAY_PORT'] ?? 3200)}`;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}
const pages = [...walk(out)].filter((f) => f.endsWith('.html'));
const sri = (bytes: Buffer | string) => `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
const csp = (html: string): string => /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1]?.replaceAll('&quot;', '"') ?? '';
const directive = (policy: string, name: string): string => policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `) || d === name) ?? '';

test.describe('@security the built export', () => {
  test('has pages to check', () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  test('every page carries a strict Content-Security-Policy and a no-referrer policy', () => {
    for (const page of pages) {
      const html = readFileSync(page, 'utf8');
      const name = relative(out, page);
      const policy = csp(html);
      expect(policy, name).not.toBe('');
      expect(directive(policy, 'default-src'), name).toBe("default-src 'none'");
      const script = directive(policy, 'script-src');
      expect(script, name).toContain("'self'");
      // 'wasm-unsafe-eval' only lets WebAssembly modules compile (Argon2, SRP, SQLite); it does not allow eval() of strings.
      expect(script.replace("'wasm-unsafe-eval'", ''), name).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:/);
      for (const d of ['style-src', 'img-src', 'font-src', 'worker-src', 'manifest-src']) expect(directive(policy, d), `${name} ${d}`).not.toMatch(/unsafe-inline|unsafe-eval/);
      expect(directive(policy, 'style-src'), name).toBe("style-src 'self'");
      expect(directive(policy, 'object-src'), name).toBe("object-src 'none'");
      expect(directive(policy, 'base-uri'), name).toBe("base-uri 'none'");
      expect(directive(policy, 'form-action'), name).toBe("form-action 'none'");
      expect(directive(policy, 'frame-src'), name).toBe("frame-src 'none'");
      expect(html, name).toContain('<meta name="referrer" content="no-referrer"/>');
    }
  });

  test('allows exactly the inline scripts the page has, by hash, and no others', () => {
    for (const page of pages) {
      const html = readFileSync(page, 'utf8');
      const allowed = new Set([...directive(csp(html), 'script-src').matchAll(/'(sha256-[^']+)'/g)].map((m) => m[1]));
      const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\ssrc=/.test(m[1]!) && !/application\/json/.test(m[1]!) && m[2]!.trim() !== '').map((m) => sri(Buffer.from(m[2]!, 'utf8')));
      expect(inline.length, relative(out, page)).toBeGreaterThan(0);
      for (const h of inline) expect(allowed.has(h), `${relative(out, page)} inline script ${h}`).toBe(true);
      expect(allowed.size, relative(out, page)).toBe(new Set(inline).size); // nothing allowed that is not there
      expect(html, relative(out, page)).not.toMatch(/\son[a-z]+="/); // no inline event handlers
      expect(html, relative(out, page)).not.toMatch(/\sstyle="/);
      expect(html, relative(out, page)).not.toMatch(/javascript:/i);
    }
  });

  test('every script and stylesheet is pinned by an integrity hash that matches the file', () => {
    let checked = 0;
    for (const page of pages) {
      const html = readFileSync(page, 'utf8');
      for (const m of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
        const tag = m[0];
        const url = /\s(?:src|href)="(\/[^"]+)"/.exec(tag)?.[1];
        const isCode = /<script\b/.test(tag) || /\srel="(?:stylesheet|modulepreload)"/.test(tag) || /\srel="preload"[^>]*\sas="(?:script|style)"/.test(tag);
        if (url === undefined || !isCode) continue;
        const file = join(out, url.split(/[?#]/)[0]!);
        expect(existsSync(file), `${relative(out, page)} → ${url}`).toBe(true);
        const integrity = /\sintegrity="([^"]+)"/.exec(tag)?.[1];
        expect(integrity, `${relative(out, page)} → ${url}`).toBe(sri(readFileSync(file)));
        expect(tag, url).toContain('crossorigin="anonymous"');
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  test('ships the headers a host must send', () => {
    const headers = readFileSync(join(out, '_headers'), 'utf8');
    for (const wanted of [
      "Content-Security-Policy: frame-ancestors 'none'", 'Referrer-Policy: no-referrer', 'X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Cross-Origin-Opener-Policy: same-origin',
      'Cross-Origin-Resource-Policy: same-origin', 'Strict-Transport-Security: max-age=', 'Permissions-Policy:',
    ]) expect(headers).toContain(wanted);
    const permissions = /Permissions-Policy: (.*)/.exec(headers)![1]!;
    for (const denied of ['camera=()', 'microphone=()', 'payment=()', 'usb=()', 'bluetooth=()']) expect(permissions).toContain(denied);
    expect(permissions).toContain('geolocation=(self)'); // the place field asks for it on request
    expect(permissions).toContain('publickey-credentials-get=(self)'); // quick unlock
    expect(headers).toMatch(/\/sw\.js\n\s+Cache-Control: no-cache/);
  });

  test('the service worker pins exactly the files that are served', () => {
    const manifest = JSON.parse(readFileSync(join(out, 'precache-manifest.json'), 'utf8')) as { version: string; files: Array<{ url: string; sha256: string }> };
    expect(manifest.version).toMatch(/^[0-9a-f]{16}$/);
    const served = new Set([...walk(out)].map((f) => `/${relative(out, f)}`).filter((u) => u !== '/sw.js' && u !== '/precache-manifest.json'));
    expect(new Set(manifest.files.map((f) => f.url))).toEqual(served);
    for (const f of manifest.files) expect(createHash('sha256').update(readFileSync(join(out, f.url))).digest('hex'), f.url).toBe(f.sha256);
    const worker = readFileSync(join(out, 'sw.js'), 'utf8');
    expect(worker).toContain(manifest.version);
    expect(worker).not.toMatch(/https?:\/\/(?!localhost)/); // it never reaches out to another origin
  });

  test('loads no third-party origin', () => {
    for (const page of pages) {
      const html = readFileSync(page, 'utf8');
      const urls = [...html.matchAll(/\s(?:src|href|action)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]!);
      expect(urls.filter((u) => !u.startsWith('https://github.com/')), relative(out, page)).toEqual([]);
    }
  });
});

async function watchViolations(page: Page): Promise<() => string[]> {
  const seen: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __csp?: string[] }).__csp ? (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`) : ((window as unknown as { __csp: string[] }).__csp = [`${e.violatedDirective} ${e.blockedURI}`]));
  });
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to|integrity/i.test(m.text())) seen.push(m.text());
  });
  return () => seen;
}

test.describe('@security the app under that policy', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });
  test.setTimeout(240_000);

  test('works from sign-up to a transaction, to another screen and back, without one policy violation', async ({ page }) => {
    const seen = await watchViolations(page);
    await page.goto('/sign-up/');
    await page.getByLabel('Email address', { exact: true }).fill(`csp+${Date.now().toString(36)}@example.com`);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByLabel('Service address').fill(RELAY);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('secret-key')).toBeVisible({ timeout: 90_000 });
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('current-fold')).toHaveText('Personal');
    for (const name of ['Accounts', 'Transactions', 'Budgets', 'Schedules', 'Goals', 'Data', 'Devices', 'Settings', 'Folds']) {
      await go(page, name);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
    await expect(page.getByTestId('current-fold')).toHaveText('Personal');
    await page.waitForTimeout(2_000); // let the service worker and the sync connection settle
    const inPage = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    expect([...inPage, ...seen()]).toEqual([]);
    expect(await page.evaluate(() => document.referrer)).toBe('');
  });

  test('refuses a script that was changed after the build', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the integrity message differs between engines; the check is the same');
    const seen = await watchViolations(page);
    let tampered = '';
    await page.route(/\/_next\/static\/chunks\/[^/]+\.js$/, async (route) => {
      if (tampered === '') {
        tampered = route.request().url();
        const response = await route.fetch();
        return route.fulfill({ response, body: `${await response.text()}\n/* changed */` });
      }
      return route.continue();
    });
    await page.goto('/sign-up/');
    await expect.poll(() => seen().some((m) => /integrity/i.test(m)), { timeout: 30_000 }).toBe(true);
    expect(tampered).not.toBe('');
  });
});
