import { expect, type Locator } from '@playwright/test';

/** Opens a kit Select (a listbox button) and clicks the option with this exact text. */
export async function choose(select: Locator, option: string): Promise<void> {
  await select.click();
  await select.page().getByRole('option', { name: option, exact: true }).click();
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
