import { expect, type Locator } from '@playwright/test';

/** Opens a kit Select (a listbox button) and clicks the option with this exact text. */
export async function choose(select: Locator, option: string): Promise<void> {
  await select.click();
  await select.page().getByRole('option', { name: option, exact: true }).click();
  await expect(select.page().getByRole('listbox')).toHaveCount(0);
}

/**
 * Chooses an account in an account dropdown by its name. An option reads as the name followed by the balance ("Everyday1,234.56 USD"; the name
 * alone when there is no balance), so the name is matched at the start and the balance, if any, is allowed after it.
 */
export async function chooseAccount(select: Locator, name: string): Promise<void> {
  await select.click();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await select.page().getByRole('option', { name: new RegExp(`^${escaped}(\\s*[−-]?\\d[\\d.,\\s\u00a0\u202f]* [A-Z]{3})?$`) }).click();
  await expect(select.page().getByRole('listbox')).toHaveCount(0);
}

const LANGUAGE_NAMES = { en: 'English', uk: 'Українська', pl: 'Polski' } as const;
const AUTOMATIC = /^(Automatic|Автоматично|Automatycznie)/;

/** Chooses a language in the language picker by its code (`auto` is "Automatic", written in whichever language is showing). */
export async function chooseLanguage(select: Locator, code: 'auto' | keyof typeof LANGUAGE_NAMES): Promise<void> {
  await select.click();
  const name = code === 'auto' ? AUTOMATIC : LANGUAGE_NAMES[code];
  await select.page().getByRole('option', { name }).click();
  await expect(select.page().getByRole('listbox')).toHaveCount(0);
}
