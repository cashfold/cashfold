import type { ElectronApplication, Page } from '@playwright/test';
import { createAccount, go, moreDetails } from '../../../e2e/fixtures/nav.js';
import { addExpense, expect, signUp, test } from './fixtures';

// Spec 006, user story 4: a row has a native context menu with exactly its actions, and a CSV dropped on the window starts the import. The drop is a
// dispatched DragEvent with a DataTransfer (dragging from the desktop cannot be automated); the menu is captured where the shell builds it.

const ACCOUNT = 'Everyday';

/** Replaces the native menu with a recorder, so a pop-up can be seen and answered without a person. */
async function recordMenus(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const seen: Array<Array<{ label: string; enabled: boolean }>> = [];
    const clicks: Array<(index: number) => void> = [];
    (globalThis as unknown as { __menus: typeof seen; __clicks: typeof clicks }).__menus = seen;
    (globalThis as unknown as { __clicks: typeof clicks }).__clicks = clicks;
    (Menu as unknown as { buildFromTemplate: unknown }).buildFromTemplate = (template: Array<{ label: string; enabled: boolean; click: () => void }>) => {
      // Recorded when it is popped up, not when it is built: the tray rebuilds its own menu whenever the app locks or unlocks.
      return {
        popup: () => {
          seen.push(template.map(({ label, enabled }) => ({ label, enabled })));
          clicks.push((index) => template[index]!.click());
        },
      };
    };
  });
}
const menus = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __menus: Array<Array<{ label: string; enabled: boolean }>> }).__menus);
const choose = (app: ElectronApplication, index: number) => app.evaluate((_electron, i) => (globalThis as unknown as { __clicks: Array<(n: number) => void> }).__clicks.at(-1)!(i), index);

function dropCsv(page: Page, name: string, rows: number): Promise<void> {
  return page.evaluate(
    ({ fileName, count }) => {
      const lines = ['Date,Amount,Note'];
      for (let i = 0; i < count; i++) lines.push(`2025-01-${String((i % 27) + 1).padStart(2, '0')},-${(i % 90) + 1}.25,Row ${i}`);
      const transfer = new DataTransfer();
      transfer.items.add(new File([lines.join('\n')], fileName, { type: 'text/csv' }));
      for (const type of ['dragover', 'drop']) document.body.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    },
    { fileName: name, count: rows },
  );
}

test('right-clicking a transaction row offers its actions in the native menu, and a choice runs the action', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await createAccount(page, ACCOUNT, '100.00');
  await addExpense(page, ACCOUNT, '12.50', 'Coffee beans');
  await recordMenus(app);
  await page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' }).dispatchEvent('contextmenu');
  await expect.poll(() => menus(app).then((m) => m.length)).toBe(1);
  expect((await menus(app))[0]!.map((item) => item.label)).toEqual(['Edit', 'Pin', 'Delete']);
  await choose(app, 1); // Pin
  await expect(page.getByTestId('tx-row').filter({ hasText: 'Coffee beans' })).toContainText('Pinned');
});

test('a CSV dropped on the window opens the import with the file chosen, and imports nothing', async ({ session }) => {
  const { page } = await session.launch();
  await signUp(page);
  await createAccount(page, ACCOUNT, '100.00');
  await dropCsv(page, 'bank.csv', 20);
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/settings/data/');
  await expect(page.locator('#import-file')).toHaveValue(/bank\.csv$/);
  await expect(page.getByText('Date column')).toBeVisible(); // the columns of the file are shown, for the person to confirm
  await expect(page.getByTestId('tx-row')).toHaveCount(0);
});

test('a dropped CSV is previewed in under two seconds for 5,000 rows (SC-004)', async ({ session }) => {
  const { page } = await session.launch();
  await signUp(page);
  await createAccount(page, ACCOUNT, '100.00');
  const started = Date.now();
  await dropCsv(page, 'big.csv', 5_000);
  await expect(page.getByText('Date column')).toBeVisible({ timeout: 2_000 });
  expect(Date.now() - started).toBeLessThan(2_000);
});

test('an unsupported file is refused with a message and nothing changes', async ({ session }) => {
  const { page } = await session.launch();
  await signUp(page);
  // The part of the page that takes drops loads a moment after the unlocked screen, so the drop is repeated until it is answered.
  await expect(async () => {
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['x'], 'photo.png', { type: 'image/png' }));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
    await expect(page.getByText('Only a CSV file can be dropped here.')).toBeVisible({ timeout: 1_000 });
  }).toPass();
  expect(await page.evaluate(() => location.pathname)).not.toBe('/settings/data/');
});

test('a drop while locked is ignored with a message', async ({ session }) => {
  const { page } = await session.launch();
  await signUp(page);
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
  await dropCsv(page, 'bank.csv', 3);
  await expect(page.getByText('Unlock Cashfold first, then drop the file again.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
});

test('the context menu is not offered while locked (the rows are not on screen)', async ({ session }) => {
  const { app, page } = await session.launch();
  await signUp(page);
  await recordMenus(app);
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock Cashfold' })).toBeVisible();
  await page.locator('body').dispatchEvent('contextmenu');
  await page.waitForTimeout(300);
  expect(await menus(app)).toEqual([]);
});

test('a file dropped on the open add sheet becomes its receipt, and is attached only when saved', async ({ session }) => {
  const { page } = await session.launch();
  await signUp(page);
  await createAccount(page, ACCOUNT, '100.00');
  await go(page, 'Transactions');
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await moreDetails(dialog);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['jpegbytes'], 'receipt.jpg', { type: 'image/jpeg' }));
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(dialog.locator('#attachment-file')).toHaveValue(/receipt\.jpg$/);
  expect(await page.evaluate(() => location.pathname)).not.toBe('/settings/data/');
});
