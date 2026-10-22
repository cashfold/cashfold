import { expect, test } from './fixtures/index.js';
import { go } from './fixtures/nav.js';

// Quick unlock with a platform authenticator (FR-006), using Chromium's virtual authenticator with the PRF extension.

const PASSWORD = 'correct horse battery staple';

test.describe('@us1 quick unlock', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'virtual WebAuthn authenticators with PRF are available through the Chromium DevTools protocol');
  });

  async function setup(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
    });
    await page.goto('/sign-up/');
    await page.getByLabel('Email address', { exact: true }).fill('alice@example.com');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByLabel('Service address').fill('https://relay.example.com');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByTestId('secret-key').waitFor({ timeout: 60_000 });
    await page.getByLabel('I have saved my Secret Key').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('current-fold')).toHaveText('Personal');
    await go(page, 'Settings');
  }

  test('turns on with the password, then unlocks without it; a browser restart brings the password back', async ({ page, context, expectNoA11yViolations }) => {
    await setup(page, context);
    await expect(page.getByRole('heading', { name: 'Quick unlock' })).toBeVisible();
    await expectNoA11yViolations();

    const section = page.getByRole('region', { name: 'Quick unlock' });
    await section.getByLabel('Password').fill('this is not my password');
    await section.getByRole('button', { name: 'Turn on quick unlock' }).click();
    await expect(section.getByRole('alert')).toContainText('not right');

    await section.getByLabel('Password').fill(PASSWORD);
    await section.getByRole('button', { name: 'Turn on quick unlock' }).click();
    await expect(section.getByText('Quick unlock is on.')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
    await page.getByRole('button', { name: 'Unlock with this device' }).click();
    await go(page, 'Folds');
    await expect(page.getByTestId('current-fold')).toHaveText('Personal', { timeout: 30_000 });

    // lock, reload in the same browser session: still offered
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Unlock with this device' })).toBeVisible({ timeout: 30_000 });

    // a browser restart clears sessionStorage: the password is required again
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Unlock with this device' })).toHaveCount(0);
  });

  test('can be turned off again, which removes the button', async ({ page, context }) => {
    await setup(page, context);
    const section = page.getByRole('region', { name: 'Quick unlock' });
    await section.getByLabel('Password').fill(PASSWORD);
    await section.getByRole('button', { name: 'Turn on quick unlock' }).click();
    await expect(section.getByText('Quick unlock is on.')).toBeVisible({ timeout: 30_000 });
    await section.getByRole('button', { name: 'Turn off quick unlock' }).click();
    await expect(section.getByRole('button', { name: 'Turn on quick unlock' })).toBeVisible();
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock with this device' })).toHaveCount(0);
  });
});
