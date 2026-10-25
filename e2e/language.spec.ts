import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { go } from './fixtures/nav.js';

// Ukrainian and Polish (spec 004): the app follows the browser's language, can be switched by hand before and after sign-in, remembers the choice,
// keeps what was typed, works offline, and does not overflow with the longer words. These specs read Ukrainian and Polish text on purpose;
// the other specs read English, so this one runs on Chromium only.

const PASSWORD = 'correct horse battery staple';

const TEXT = {
  en: { signUp: 'Create your account', starterFold: 'Personal', category: 'Food & Drink' },
  uk: { signUp: 'Створіть обліковий запис', starterFold: 'Особистий', category: 'Їжа та напої', createAccount: 'Створити рахунок', add: 'Додати', name: 'Назва', opening: /^Початковий баланс/ },
  pl: { signUp: 'Utwórz konto', starterFold: 'Osobista', category: 'Jedzenie i napoje', createAccount: 'Utwórz konto', add: 'Dodaj', name: 'Nazwa', opening: /^Saldo początkowe/ },
} as const;

/** English words that must not appear on a screen that is in another language. */
const ENGLISH_MARKERS = ['Create account', 'Transactions', 'Settings', 'Dashboard', 'Accounts', 'Budgets', 'Cancel', 'Save', 'Lock', 'Add account'];

test.describe('@language', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Ukrainian and Polish text is read on Chromium; the rtl and pseudo projects cover other layouts');
    test.skip(test.info().project.name !== 'chromium', 'one project is enough');
  });

  async function signUp(page: Page, expectedFold: string): Promise<void> {
    await page.locator('input[type=email]').fill('alice@example.com');
    const passwords = page.locator('input[type=password]');
    await passwords.nth(0).fill(PASSWORD);
    await passwords.nth(1).fill(PASSWORD);
    await page.locator('input[type=url]').fill('https://relay.example.com');
    await page.locator('form button[type=submit]').click();
    await page.getByTestId('secret-key').waitFor({ timeout: 60_000 });
    await page.locator('[role=checkbox]').first().check();
    await page.locator('main button:not([disabled])').last().click();
    await expect(page.getByTestId('current-fold').first()).toHaveText(expectedFold, { timeout: 30_000 });
  }

  const noSideways = (page: Page, message: string) =>
    expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message, timeout: 5_000 }).toBeLessThanOrEqual(1);

  const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang);

  for (const language of ['uk', 'pl'] as const) {
    test.describe(`browser language ${language}`, () => {
      test.use({ locale: language });

      test('the whole journey is in the language: sign-up, starter names, every main screen, no sideways scrolling', async ({ page, expectNoA11yViolations }) => {
        test.setTimeout(180_000);
        const words = TEXT[language];
        await page.goto('/sign-up/');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(words.signUp);
        expect(await htmlLang(page)).toBe(language);
        await expectNoA11yViolations();

        await signUp(page, words.starterFold);
        expect(await htmlLang(page)).toBe(language);

        // The starter categories were created in the language (FR-015).
        await go(page, 'Categories');
        await expect(page.getByText(words.category).first()).toBeVisible();

        for (const size of [{ width: 320, height: 640 }, { width: 1280, height: 800 }]) {
          await page.setViewportSize(size);
          for (const screen of ['Overview', 'Transactions', 'Accounts', 'Budgets', 'Goals', 'Schedules', 'Settings', 'Appearance', 'Categories', 'Folds', 'Data', 'Devices'] as const) {
            await go(page, screen);
            await expect(page.locator('h1').first()).toBeVisible();
            await noSideways(page, `${screen} at ${size.width} in ${language}`);
            const text = await page.locator('main').innerText();
            for (const marker of ENGLISH_MARKERS) expect(text, `${screen} shows "${marker}"`).not.toContain(marker);
          }
        }
        await page.setViewportSize({ width: 1280, height: 800 });
        await go(page, 'Overview');
        await expectNoA11yViolations();
      });

      test('the add sheet opens on a phone and nothing scrolls sideways', async ({ page }) => {
        test.setTimeout(180_000);
        const words = TEXT[language];
        await page.goto('/sign-up/');
        await signUp(page, words.starterFold);
        await page.setViewportSize({ width: 390, height: 640 });
        await go(page, 'Transactions');
        await page.getByRole('button', { name: words.add, exact: true }).first().click();
        await page.getByRole('dialog').waitFor({ state: 'attached' });
        await noSideways(page, `the add sheet in ${language}`);
      });

      test('an amount typed with an ordinary space and a comma is saved and shown back the way the language writes it', async ({ page }) => {
        test.setTimeout(180_000);
        const words = TEXT[language];
        await page.goto('/sign-up/');
        await signUp(page, words.starterFold);
        await go(page, 'Accounts');
        await page.locator('main h1').locator('xpath=..').getByRole('button').first().click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel(words.name, { exact: true }).fill('Everyday');
        await dialog.getByLabel(words.opening).fill('1 234,56');
        await dialog.getByRole('button', { name: words.createAccount, exact: true }).click();
        await page.getByRole('link', { name: 'Everyday', exact: true }).waitFor();
        // Shown with a no-break space and a comma: 1 234,56
        await expect(page.locator('main')).toContainText(/1[\s  ]234,56/);
      });
    });
  }

  test.describe('choosing the language by hand', () => {
    test('before sign-in: the footer picker changes the page at once, keeps what was typed, and survives a reload', async ({ page }) => {
      await page.goto('/sign-up/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.en.signUp);
      await page.locator('input[type=email]').fill('typed@example.com');

      const picker = page.getByLabel('Language');
      await picker.selectOption('pl');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.pl.signUp, { timeout: 1_000 });
      expect(await htmlLang(page)).toBe('pl');
      await expect(page.locator('input[type=email]')).toHaveValue('typed@example.com');

      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.pl.signUp);
      expect(await htmlLang(page)).toBe('pl');

      await page.getByLabel('Język').selectOption('uk');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.uk.signUp, { timeout: 1_000 });

      // "Automatic" follows the browser again (English here).
      await page.getByLabel('Мова').selectOption('auto');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.en.signUp);
      expect(await htmlLang(page)).toBe('en');
    });

    test('the choice beats the browser language, and the picker is the same on the unlock screen', async ({ page }) => {
      await page.goto('/sign-up/');
      await page.getByLabel('Language').selectOption('uk');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.uk.signUp);
      // Another page of the same app, still before sign-in: the language is kept.
      await page.goto('/');
      await expect(page.getByLabel('Мова')).toHaveValue('uk');
      expect(await htmlLang(page)).toBe('uk');
    });

    test('in Settings after sign-in: the choice is remembered, and Automatic goes back to the browser', async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto('/sign-up/');
      await signUp(page, TEXT.en.starterFold);
      await go(page, 'Appearance');
      await page.getByLabel('Language').selectOption('uk');
      await expect(page.locator('h1').first()).toHaveText('Вигляд', { timeout: 1_000 });
      await page.reload();
      // Reloading locks the app; the language is kept on the unlock screen.
      expect(await htmlLang(page)).toBe('uk');
      await expect(page.getByLabel('Мова')).toHaveValue('uk');
    });

    test.describe('a Polish browser', () => {
      test.use({ locale: 'pl' });

      test('a saved English choice wins over the browser, and Automatic follows the browser again', async ({ page }) => {
        await page.goto('/sign-up/');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.pl.signUp);
        await page.getByLabel('Język').selectOption('en');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.en.signUp);
        await page.reload();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.en.signUp);
        await page.getByLabel('Language').selectOption('auto');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.pl.signUp);
      });
    });

    test('works offline: the catalogue is in the precache', async ({ page, context }) => {
      await page.goto('/sign-up/');
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      await page.reload();
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
      await context.setOffline(true);
      await page.reload();
      await page.getByLabel('Language').selectOption('uk');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.uk.signUp, { timeout: 5_000 });
      await page.getByLabel('Мова').selectOption('pl');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.pl.signUp, { timeout: 5_000 });
    });
  });

  test('the fonts have the letters of both languages', async ({ page }) => {
    await page.goto('/sign-up/');
    await page.getByLabel('Language').selectOption('uk');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.uk.signUp);
    const missing = await page.evaluate(async () => {
      await document.fonts.ready;
      const out: string[] = [];
      for (const [name, letters] of [['Cyrillic', 'ҐґЄєІіЇї'], ['Latin Extended', 'ĄĆĘŁŃÓŚŹŻąćęłńóśźż']] as const) {
        // Loading by the character makes the browser fetch the face whose unicode-range holds it.
        const loaded = await document.fonts.load('16px Ubuntu', letters);
        if (loaded.length === 0 || !document.fonts.check('16px Ubuntu', letters)) out.push(name);
      }
      return out;
    });
    expect(missing).toEqual([]);
  });
});
