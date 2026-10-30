import type { Browser, BrowserContext, Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { expect, test } from './fixtures/index.js';
import { accountAction, go, moreDetails, openAddTransaction } from './fixtures/nav.js';
import { chooseAccount } from './fixtures/select.js';

// User story 4: the same data on several devices, through a relay that sees only ciphertext (FR-004, FR-010, FR-072 to FR-082).
// Two real browsers (separate contexts, so separate encrypted databases) and the real relay built from this checkout.

const PASSWORD = 'correct horse battery staple';
const RELAY_PORT = Number(process.env['E2E_RELAY_PORT'] ?? 3200);
const RELAY = `http://localhost:${RELAY_PORT}`;
/**
 * A TCP hop between one browser and the relay that can be cut and restored, for HTTP and WebSocket alike. (A browser context's
 * own offline switch does not reach a worker's connections, and the service worker is not the thing under test.)
 */
async function relayLink(): Promise<{ url: string; setUp(up: boolean): void; close(): Promise<void> }> {
  let up = true;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    if (!up) return void client.destroy();
    const upstream = net.connect(RELAY_PORT, '127.0.0.1');
    for (const s of [client, upstream]) sockets.add(s);
    const done = () => {
      for (const s of [client, upstream]) {
        s.destroy();
        sockets.delete(s);
      }
    };
    client.pipe(upstream);
    upstream.pipe(client);
    for (const s of [client, upstream]) s.on('error', done).on('close', done);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `http://localhost:${port}`,
    setUp(next) {
      up = next;
      if (!next) for (const s of sockets) s.destroy();
    },
    close: () => new Promise<void>((resolve) => (server.close(() => resolve()), sockets.forEach((s) => s.destroy()))),
  };
}

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The reference connection of SC-005: 150 ms round trip, 5 Mbit/s. Chromium only; other browsers run unthrottled. */
async function throttle(page: Page, browserName: string): Promise<void> {
  if (browserName !== 'chromium') return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 75, downloadThroughput: (5 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 });
}


async function signUp(page: Page, email: string, server = RELAY): Promise<string> {
  await page.goto('/sign-up/');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByLabel('Keep everything on this device for now').uncheck();
  await page.getByLabel('Service address').fill(server);
  await page.getByRole('button', { name: 'Create account' }).click();
  const secret = page.getByTestId('secret-key');
  await expect(secret).toBeVisible({ timeout: 90_000 });
  const key = (await secret.textContent())!.trim();
  await page.getByLabel('I have saved my Secret Key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('current-fold')).toHaveText('Personal');
  return key;
}

async function addAccount(page: Page, name: string, opening = '100.00'): Promise<void> {
  await go(page, 'Accounts');
  const dialog = page.getByRole('dialog');
  // A click that lands before the screen is ready is swallowed, so it is repeated until the dialog is open (as openAddTransaction does) instead of
  // waiting out the test timeout for a dialog that will never come.
  await expect(async () => {
    if ((await dialog.count()) === 0) await page.getByRole('button', { name: 'Add account', exact: true }).click({ timeout: 5_000 });
    await expect(dialog).toHaveCount(1, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Opening balance (USD)').fill(opening);
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

async function addExpense(page: Page, account: string, amount: string, note: string): Promise<void> {
  await go(page, 'Transactions');
  await openAddTransaction(page);
  const dialog = page.getByRole('dialog');
  await chooseAccount(dialog.getByLabel('Account'), `${account}`);
  await dialog.getByLabel('Amount (USD)').fill(amount);
  await moreDetails(dialog);
  await dialog.getByLabel('Note').fill(note);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function enrol(browser: Browser, email: string, secretKey: string, server = RELAY): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const fragment = new URLSearchParams({ email, server, key: secretKey });
  await page.goto(`/add/#${fragment.toString()}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add this device' })).toBeVisible();
  // The link is read once and gone from the address bar and history before anything else happens.
  await expect.poll(() => page.url()).not.toContain('#');
  expect(await page.evaluate(() => location.href + history.length)).not.toContain(secretKey);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Add this device' }).click();
  await expect(page).toHaveURL(/\/overview\/$/, { timeout: 90_000 });
  return { context, page };
}

const syncState = (page: Page) => page.locator('[data-sync-state]');

test.describe('@us4 sync', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
  });
  test.setTimeout(240_000);

  test('adds a second browser from the link, and shows the same data on both', async ({ page, browser, expectNoA11yViolations }) => {
    const email = `alice+${unique()}@example.com`;
    const secretKey = await signUp(page, email);
    await addAccount(page, 'Everyday', '1,000.00');
    await addExpense(page, 'Everyday', '12.50', 'Coffee beans');
    await expect(syncState(page)).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });

    const b = await enrol(browser, email, secretKey);
    await go(b.page, 'Accounts');
    await expect(b.page.getByRole('link', { name: 'Everyday', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(b.page.getByTestId('account-row').filter({ hasText: 'Everyday' }).getByTestId('account-balance')).toHaveText('987.50 USD');
    await go(b.page, 'Transactions');
    await expect(b.page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' })).toHaveCount(1);

    await go(b.page, 'Devices');
    await expect(b.page.getByRole('heading', { level: 1, name: 'Devices' })).toBeVisible();
    await expect(b.page.getByText('(this device)')).toBeVisible();
    await expectNoA11yViolations();
    await b.context.close();
  });

  async function pair(page: Page, browser: Browser, browserName: string) {
    const email = `alice+${unique()}@example.com`;
    const linkA = await relayLink();
    const linkB = await relayLink();
    const secretKey = await signUp(page, email, linkA.url);
    await addAccount(page, 'Everyday', '1,000.00');
    await expect(syncState(page)).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });
    const b = await enrol(browser, email, secretKey, linkB.url);
    await throttle(page, browserName);
    await throttle(b.page, browserName);
    await go(page, 'Transactions');
    // The second device is only ready once it has the account: a test that cuts the connection straight away would otherwise leave it with nothing.
    await go(b.page, 'Accounts');
    await expect(b.page.getByTestId('account-row').filter({ hasText: 'Everyday' })).toHaveCount(1, { timeout: 60_000 });
    await go(b.page, 'Transactions');
    return { email, secretKey, b, linkA, linkB };
  }

  const rows = (page: Page, note: string) => page.getByTestId('tx-row').filter({ hasText: note });

  test('reaches the other device within 5 seconds, 95 times in 100, on the reference connection', async ({ page, browser, browserName }) => {
    test.setTimeout(900_000);
    const { b } = await pair(page, browser, browserName);
    const elapsed: number[] = [];
    for (let i = 0; i < 100; i++) {
      const note = `change ${i}`;
      await addExpense(page, 'Everyday', '1.00', note);
      const started = Date.now();
      await expect(rows(b.page, note)).toHaveCount(1, { timeout: 20_000 });
      elapsed.push(Date.now() - started);
      if (elapsed.at(-1)! > 3_000) console.log(`slow: change ${i} took ${elapsed.at(-1)} ms`);
    }
    elapsed.sort((x, y) => x - y);
    const p95 = elapsed[Math.floor(elapsed.length * 0.95) - 1]!;
    console.log(`propagation over ${elapsed.length} changes: median ${elapsed[50]} ms, p95 ${p95} ms, max ${elapsed.at(-1)} ms`);
    expect(p95).toBeLessThan(5_000);
    await b.context.close();
  });

  test('keeps what each device did while both were offline, and settles a clash on one value', async ({ page, browser, browserName }) => {
    const { b, linkA, linkB } = await pair(page, browser, browserName);
    linkA.setUp(false);
    linkB.setUp(false);
    await addExpense(page, 'Everyday', '3.00', 'only on the first');
    await addExpense(b.page, 'Everyday', '4.00', 'only on the second');
    // the very same field changed on both: the account's name
    for (const [p, name] of [[page, 'Everyday (first)'], [b.page, 'Everyday (second)']] as const) {
      await go(p, 'Accounts');
      await accountAction(p, 'Everyday', 'Edit');
      await p.getByRole('dialog').getByLabel('Name', { exact: true }).fill(name);
      await p.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
      await expect(p.getByRole('dialog')).toHaveCount(0);
      await go(p, 'Transactions');
    }
    await expect(syncState(page)).toHaveAttribute('data-sync-state', /offline|error|idle/);

    linkA.setUp(true);
    linkB.setUp(true);
    for (const p of [page, b.page]) {
      await expect(rows(p, 'only on the first')).toHaveCount(1, { timeout: 60_000 });
      await expect(rows(p, 'only on the second')).toHaveCount(1, { timeout: 60_000 });
    }
    // no duplicates, and both devices settle on the same name
    await go(page, 'Accounts');
    await go(b.page, 'Accounts');
    const names = async (p: Page) => (await p.getByTestId('account-row').allTextContents()).map((t) => /Everyday \((first|second)\)/.exec(t)?.[0]);
    await expect.poll(async () => JSON.stringify([await names(page), await names(b.page)]), { timeout: 60_000 }).toMatch(/^\[\["(Everyday \((?:first|second)\))"\],\["\1"\]\]$/);
    expect(await page.getByTestId('account-row').count()).toBe(1);
    await expect(syncState(page)).toHaveAttribute('data-sync-state', 'synced', { timeout: 60_000 });
    await b.context.close();
  });

  test('resumes an interrupted sync without losing or repeating anything', async ({ page, browser, browserName }) => {
    const { b, linkA } = await pair(page, browser, browserName);
    for (let i = 0; i < 6; i++) {
      if (i === 3) linkA.setUp(false);
      await addExpense(page, 'Everyday', '2.00', `interrupted ${i}`);
    }
    linkA.setUp(true);
    for (let i = 0; i < 6; i++) await expect(rows(b.page, `interrupted ${i}`)).toHaveCount(1, { timeout: 60_000 });
    await expect(b.page.getByTestId('tx-row').filter({ hasText: 'interrupted' })).toHaveCount(6);
    await b.context.close();
  });

  test('rejects a tampered update with a notice, and carries on with the genuine ones', async ({ page, browser, browserName }) => {
    const { email, secretKey, b } = await pair(page, browser, browserName);
    await rogueDevicePushesGarbage(email, secretKey);
    await expect(b.page.getByTestId('attention')).toContainText('could not be decrypted', { timeout: 60_000 });
    await addExpense(page, 'Everyday', '5.00', 'after the tampering');
    await expect(rows(b.page, 'after the tampering')).toHaveCount(1, { timeout: 30_000 });
    await b.context.close();
  });

  test('wipes a removed device, which then cannot sync', async ({ page, browser, browserName }) => {
    const { b } = await pair(page, browser, browserName);
    await go(page, 'Devices');
    const other = page.getByRole('listitem').filter({ hasText: 'Added' }).filter({ hasNotText: '(this device)' });
    await expect(other).toHaveCount(1);
    await other.getByRole('button', { name: 'Remove', exact: true }).click();
    await other.getByRole('button', { name: 'Remove device' }).click();
    await expect(other.getByText('(removed)')).toBeVisible();

    // the removed device finds out the next time it talks to the service
    await addExpense(b.page, 'Everyday', '9.00', 'typed after removal');
    await expect(b.page.getByRole('alert').filter({ hasText: 'was removed from the account' })).toBeVisible({ timeout: 60_000 });
    await b.page.reload();
    await expect(b.page.getByText('There is no account on this device').or(b.page.getByRole('link', { name: 'Create account' })).first()).toBeVisible({ timeout: 30_000 });
    await expect(rows(page, 'typed after removal')).toHaveCount(0);
    await b.context.close();
  });
});

/** An attacker who somehow holds an account's credentials still cannot make other devices accept garbage: it fails the tag check. */
async function rogueDevicePushesGarbage(email: string, secretKeyText: string): Promise<void> {
  const [{ createAccountCrypto }, { createWebRelayAuth }, { createPake, loadSrpBigint, createEd25519Signer, SecretBuf }, { encodeOpEnvelope }, { opSigningBytes }, core] = await Promise.all([
    import('../apps/web/src/adapters/account-crypto.ts'), import('../apps/web/src/adapters/transport/relay-auth.ts'), import('../packages/crypto/src/index.ts'),
    import('../packages/protocol/src/index.ts'), import('../packages/protocol/src/schemas/op-wire.ts'), import('../packages/core/src/index.ts'),
  ]);
  const rng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };
  const dir = new URL('../packages/crypto/src/adapters/srp-wasm/', import.meta.url);
  const pake = createPake({ bn: await loadSrpBigint(new Uint8Array(readFileSync(new URL('srp-bigint.wasm', dir))), readFileSync(new URL('srp-bigint.wasm.sha256', dir), 'utf8')), rng });
  const accountCrypto = createAccountCrypto({ rng });
  const handle = await accountCrypto.begin({ email, password: SecretBuf.from(new TextEncoder().encode(PASSWORD)), secretKeyText });
  if (handle === 'invalid_secret_key') throw new Error('bad key');
  const deviceId = core.newIdV4((n) => rng.bytes(n));
  const signed = await createWebRelayAuth({ pake: async () => pake }).signIn({ server: RELAY, email, deviceId, deriveX: (hello) => handle.deriveSrpX(hello) });
  if (!signed.ok) throw new Error(`rogue sign-in failed: ${signed.kind}`);
  const signer = createEd25519Signer();
  const pair = await signer.generate(rng);
  const devId = core.idToBytes(deviceId);
  expect((await signed.link.request('POST', '/devices', { dev_id: devId, sig_pk: pair.publicKey })).ok).toBe(true);
  const folds = await signed.link.request('GET', '/folds');
  const fold = (folds.ok && Array.isArray(folds.body) ? (folds.body[0] as Map<string, Uint8Array>).get('fold') : undefined)!;
  const unsigned = { v: 1 as const, fold, op: randomBytes(16), rec: randomBytes(16), dev: devId, seq: 1n, hlc: { wallMs: Date.now(), ctr: 0 }, epoch: 1, schema: 1, blob: randomBytes(120), sig: new Uint8Array(64) };
  const sig = await signer.sign(pair.secretKey, opSigningBytes(unsigned));
  const pushed = await signed.link.request('POST', `/folds/${core.foldRef(core.idFromBytes(fold))}/ops`, [encodeOpEnvelope({ ...unsigned, sig })]);
  expect(pushed.ok).toBe(true);
  const result = pushed.ok && Array.isArray(pushed.body) ? (pushed.body[0] as Map<string, unknown>) : undefined;
  expect(result?.get('error'), 'the service accepts the envelope: it cannot tell').toBeUndefined();
  signed.link.close();
}
