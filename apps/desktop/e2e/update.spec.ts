import AxeBuilder from '@axe-core/playwright';
import { go } from '../../../e2e/fixtures/nav.js';
import { expect, signUp, test, type Running, type Session } from './fixtures';
import { FeedServer, type FeedOptions } from './feed-server';

// User story 3: the app finds a newer version, tells the person, and does nothing more until they choose (FR-013 to FR-017, FR-031;
// contract B-2, B-3, B-4, B-8, B-9). Needs a build made with the test feed (scripts/test-update.mjs does that and sets CASHFOLD_UPDATE_TEST).
//
// Downloading and verifying an update runs the updater's real download, which on macOS is tied to an app signed by Apple (Squirrel.Mac): those
// steps run on Windows and Linux, and on macOS once the app is signed. The offer, the consent, the notice, the automatic checks and the offline
// state run everywhere.

test.skip(process.env['CASHFOLD_UPDATE_TEST'] === undefined, 'needs the test-feed build: run `pnpm --filter @cashfold/desktop test:update`');
const canDownload = process.platform !== 'darwin';

async function launchWithFeed(session: Session, feed: FeedServer, extra: Record<string, string> = {}): Promise<Running> {
  const running = await session.launch({
    env: { CASHFOLD_TEST_FEED: feed.url, CASHFOLD_TEST_UPDATE_KEY: feed.trustedKey, CASHFOLD_TEST_UPDATE_MODE: 'in-app', ...extra },
  });
  return running;
}

async function withFeed<T>(options: FeedOptions, use: (feed: FeedServer) => Promise<T>): Promise<T> {
  const feed = new FeedServer(options);
  await feed.start();
  try {
    return await use(feed);
  } finally {
    await feed.stop();
  }
}

test('a newer version is offered, and nothing is downloaded until the person says so', async ({ session }) => {
  await withFeed({}, async (feed) => {
    const { page } = await launchWithFeed(session, feed);
    await signUp(page);
    await go(page, 'Advanced');
    await expect(page.getByTestId('update-controls')).toBeVisible();
    await page.getByTestId('update-check').click();
    await expect(page.getByTestId('update-message')).toHaveText('Version 1.3.0 is available.');
    await expect(page.getByTestId('update-download')).toBeVisible();
    // The feed was read; the installer and its signature were not asked for.
    await page.waitForTimeout(1_500);
    expect(feed.requests.some((r) => /latest.*\.yml$/.test(r))).toBe(true);
    expect(feed.downloads).toEqual([]);
    await expect(page.getByTestId('update-install')).toHaveCount(0);
  });
});

test('says so when there is nothing newer', async ({ session }) => {
  await withFeed({ version: '0.0.0' }, async (feed) => {
    const { page } = await launchWithFeed(session, feed);
    await signUp(page);
    await go(page, 'Advanced');
    await page.getByTestId('update-check').click();
    await expect(page.getByTestId('update-message')).toHaveText('You have the latest version.');
  });
});

test('tells the person when the update service cannot be reached, and stays usable', async ({ session }) => {
  const feed = new FeedServer();
  await feed.start();
  const { page } = await launchWithFeed(session, feed);
  await feed.stop(); // gone before the first look
  await signUp(page);
  await go(page, 'Advanced');
  await page.getByTestId('update-check').click();
  await expect(page.getByTestId('update-message')).toContainText('Could not reach the update service', { timeout: 40_000 });
  await expect(page.getByTestId('update-check')).toBeEnabled();
});

test('a quiet note appears in the app when a version is waiting, and can be dismissed', async ({ session }) => {
  await withFeed({}, async (feed) => {
    const { page } = await launchWithFeed(session, feed);
    await signUp(page);
    // The automatic check runs shortly after the app starts.
    const notice = page.getByTestId('update-notice');
    await expect(notice).toBeVisible({ timeout: 40_000 });
    await expect(notice).toContainText('Version 1.3.0 of Cashfold is available.');
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid=update-notice]') === null)).toBe(true); // it did not take focus
    // The note and the update section pass the same accessibility checks as the rest of the interface.
    const noticeResults = await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(noticeResults.violations).toEqual([]);
    await go(page, 'Advanced');
    await expect(page.getByTestId('update-message')).toHaveText('Version 1.3.0 is available.'); // found by the automatic check already
    const sectionResults = await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(sectionResults.violations).toEqual([]);
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);
  });
});

test('with automatic checks switched off the app makes no request, and a check by hand still works (B-8)', async ({ session }) => {
  await withFeed({}, async (feed) => {
    const first = await launchWithFeed(session, feed);
    await signUp(first.page);
    await go(first.page, 'Advanced');
    const auto = first.page.getByTestId('update-auto');
    await expect(auto).toBeEnabled();
    await auto.click();
    await expect(auto).toHaveAttribute('aria-checked', 'false');
    await session.quit(first.app);
    feed.requests.length = 0;

    const second = await launchWithFeed(session, feed);
    await second.page.goto('app://cashfold/settings/advanced/');
    await expect(second.page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 30_000 });
    await second.page.waitForTimeout(14_000); // longer than the delay of the automatic check
    expect(feed.requests).toEqual([]);

    await second.page.getByLabel('Password').fill('correct horse battery staple');
    await second.page.getByRole('button', { name: 'Unlock' }).click();
    await go(second.page, 'Advanced');
    await expect(second.page.getByTestId('update-auto')).toHaveAttribute('aria-checked', 'false'); // the choice was kept
    await second.page.getByTestId('update-check').click();
    await expect(second.page.getByTestId('update-message')).toHaveText('Version 1.3.0 is available.');
    expect(feed.requests.length).toBeGreaterThan(0);
  });
});

test.describe('downloading', () => {
  test.skip(!canDownload, 'the real download on macOS needs a signed app');

  test('a genuine update is downloaded on request, checked, and only then offered for installation', async ({ session }) => {
    await withFeed({}, async (feed) => {
      const { page } = await launchWithFeed(session, feed);
      await signUp(page);
      await go(page, 'Advanced');
      await page.getByTestId('update-check').click();
      const started = Date.now();
      await page.getByTestId('update-download').click();
      await expect(page.getByTestId('update-message')).toContainText('is ready', { timeout: 120_000 });
      expect(Date.now() - started).toBeLessThan(5 * 60_000); // SC-006
      await expect(page.getByTestId('update-install')).toBeVisible();
      expect(feed.downloads.some((r) => r.endsWith('.sig'))).toBe(true);
    });
  });

  for (const signature of ['missing', 'altered', 'stranger', 'other-file'] as const) {
    test(`an update whose signature is ${signature} is refused and cannot be installed (B-9)`, async ({ session }) => {
      await withFeed({ signature }, async (feed) => {
        const { page } = await launchWithFeed(session, feed);
        await signUp(page);
        await go(page, 'Advanced');
        await page.getByTestId('update-check').click();
        await page.getByTestId('update-download').click();
        await expect(page.getByTestId('update-message')).toContainText('could not be verified', { timeout: 120_000 });
        await expect(page.getByTestId('update-install')).toHaveCount(0);
        await expect(page.getByTestId('update-check')).toBeVisible();
      });
    });
  }

  test('a download that does not match the feed is refused', async ({ session }) => {
    await withFeed({ corruptInstaller: true }, async (feed) => {
      const { page } = await launchWithFeed(session, feed);
      await signUp(page);
      await go(page, 'Advanced');
      await page.getByTestId('update-check').click();
      await page.getByTestId('update-download').click();
      await expect(page.getByTestId('update-message')).toContainText(/could not be verified|did not finish/, { timeout: 120_000 });
      await expect(page.getByTestId('update-install')).toHaveCount(0);
    });
  });
});
