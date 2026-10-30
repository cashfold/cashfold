import { expect, type Locator } from '@playwright/test';

/**
 * Opens a kit Select and clicks an option, until the list has closed. A click that lands before the list is ready is swallowed (seen on
 * Firefox, where the list then stays open), so the steps are repeated: open it again if it is closed, click the option, wait for it to close.
 */
async function pick(select: Locator, option: Locator): Promise<void> {
  const listbox = select.page().getByRole('listbox');
  await expect(async () => {
    if ((await listbox.count()) === 0) await select.click({ timeout: 5_000 });
    await option.click({ timeout: 5_000 });
    await expect(listbox).toHaveCount(0, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

/** Opens a kit Select (a listbox button) and clicks the option with this exact text. */
export async function choose(select: Locator, option: string): Promise<void> {
  await pick(select, select.page().getByRole('option', { name: option, exact: true }));
}

/**
 * Chooses an account in an account dropdown by its name. An option reads as the name followed by the balance ("Everyday1,234.56 USD"; the name
 * alone when there is no balance), so the name is matched at the start and the balance, if any, is allowed after it.
 */
export async function chooseAccount(select: Locator, name: string): Promise<void> {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await pick(select, select.page().getByRole('option', { name: new RegExp(`^${escaped}(\\s*[−-]?\\d[\\d.,\\s\u00a0\u202f]* [A-Z]{3})?$`) }));
}

const LANGUAGE_NAMES = { en: 'English', uk: 'Українська', pl: 'Polski' } as const;
const AUTOMATIC = /^(Automatic|Автоматично|Automatycznie)/;

/** Chooses a language in the language picker by its code (`auto` is "Automatic", written in whichever language is showing). */
export async function chooseLanguage(select: Locator, code: 'auto' | keyof typeof LANGUAGE_NAMES): Promise<void> {
  const name = code === 'auto' ? AUTOMATIC : LANGUAGE_NAMES[code];
  await pick(select, select.page().getByRole('option', { name }));
}
