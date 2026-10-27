import type { Page } from '@playwright/test';
import { go } from '../../../e2e/fixtures/nav.js';
import { APP_ORIGIN, expect, readShellLog, signUp, test } from './fixtures';

// Spec 007: the desktop app feels like an application and not a web page. No menu bar, no selectable interface text, native pointers.
// Right-click menus, real drag and drop from the desktop, and pinch zoom cannot be driven from here; they are in the manual steps of
// specs/007-desktop-native-feel/quickstart.md, and the menu itself is covered by text-menu.test.ts.

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function openSignIn(session: Parameters<Parameters<typeof test>[2]>[0]['session']): Promise<Page> {
  const { page } = await session.launch();
  await page.goto(`${APP_ORIGIN}/sign-in/`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return page;
}

/** A field of our own: the sign-in form only appears once the app's worker is up, which these tests do not need. */
const addField = (page: Page) => page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<input id="field" type="text" aria-label="field" />'));

const style = (page: Page, selector: string, property: string) => page.locator(selector).first().evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);

test.describe('no menu bar', () => {
  test('the application has no File, Edit, View, Window or Help menu, and Alt brings none back', async ({ session }) => {
    const { app, page } = await session.launch();
    const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? null);
    if (process.platform === 'darwin') expect(labels).toEqual(['Cashfold']);
    else expect(labels).toBeNull();
    await page.keyboard.press('Alt');
    await page.keyboard.up('Alt');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMenuBarVisible())).toBe(process.platform === 'darwin');
  });

  test('copy, paste and select all still work in a field, without a menu', async ({ session }) => {
    const page = await openSignIn(session);
    await addField(page);
    const email = page.locator('#field');
    await email.fill('alice@example.com');
    await email.press(`${mod}+a`);
    await email.press(`${mod}+c`);
    await email.fill('');
    await email.press(`${mod}+v`);
    await expect(email).toHaveValue('alice@example.com');
  });
});

test.describe('selection', () => {
  test('interface text cannot be selected, a field and a copy-on-purpose value can', async ({ session }) => {
    const page = await openSignIn(session);
    const heading = page.getByRole('heading', { level: 1 });
    expect(await heading.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
    await heading.dblclick();
    await heading.click({ clickCount: 3 });
    await page.keyboard.press(`${mod}+a`);
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');

    await page.evaluate(() => {
      const value = document.createElement('p');
      value.setAttribute('data-selectable', 'true');
      value.id = 'copy-me';
      value.textContent = 'A3-123456-ABCDEF';
      document.body.append(value);
    });
    await page.locator('#copy-me').click({ clickCount: 3 });
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toContain('A3-123456-ABCDEF');

    await addField(page);
    const email = page.locator('#field');
    await email.fill('typed text');
    await email.press(`${mod}+a`);
    expect(await email.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0))).toBe('typed text');
  });
});

test.describe('pointers', () => {
  test('the arrow on actions, the text pointer on text, the hand only on a link out of the app', async ({ session }) => {
    const page = await openSignIn(session);
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<input id="on" type="text" /><a id="out" href="https://example.com/" target="_blank" rel="noopener noreferrer">out</a><a id="in" href="/sign-up/">in</a><button id="off" disabled>off</button><input id="off-input" disabled /><span id="v" data-selectable="true">v</span><div id="row" class="cursor-pointer">row</div>',
      );
    });
    expect(await style(page, 'button', 'cursor')).toBe('default');
    expect(await style(page, '#on', 'cursor')).toBe('text');
    expect(await style(page, '#v', 'cursor')).toBe('text');
    expect(await style(page, '#out', 'cursor')).toBe('pointer');
    expect(await style(page, '#in', 'cursor')).toBe('default');
    expect(await style(page, '#off', 'cursor')).toBe('default');
    expect(await style(page, '#off-input', 'cursor')).toBe('default');
    expect(await style(page, '#row', 'cursor')).toBe('default');
  });
});

test.describe('other web-page habits', () => {
  test('images do not drag and the page does not bounce', async ({ session }) => {
    const page = await openSignIn(session);
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<img id="pic" alt="" src="/icon.svg" />'));
    expect(await style(page, '#pic', '-webkit-user-drag')).toBe('none');
    expect(await style(page, 'html', 'overscroll-behavior-y')).toBe('none');
  });

  test('a file dropped where files are not taken leaves the app where it is', async ({ session }) => {
    const page = await openSignIn(session);
    await page.evaluate(() => {
      location.href = 'file:///etc/hosts';
    });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => location.origin)).toBe(APP_ORIGIN);
    expect(readShellLog(session.userDataDir).some((line) => line.event === 'security.navigation-blocked')).toBe(false);
  });
});

test('the interface never says "browser" in the desktop app', async ({ session }) => {
  const { page } = await session.launch();
  await signUp(page);
  for (const screen of ['Overview', 'Transactions', 'Accounts', 'Plan', 'Settings', 'Appearance', 'Data', 'Profile', 'Devices', 'Categories', 'Advanced', 'Desktop']) {
    await go(page, screen);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.locator('body').innerText(), screen).not.toMatch(/browser/i);
  }
  await go(page, 'Appearance');
  await expect(page.locator('select[name="language"] option[value="auto"]')).toHaveText('Automatic (follow the system)');
});
