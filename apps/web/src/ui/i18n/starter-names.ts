import { defaultCategories } from '@cashfold/core';
import type { Translate } from './i18n';

// FR-015: what a new person starts with (the personal Fold and the default categories) is created in the language they are using, and is theirs
// from then on. `core` keeps the English names and the ids; the words come from the catalogue under `starter.*`.

const KEYS = defaultCategories('00000000-0000-4000-8000-000000000000' as never).map((c) => c.key);

/** Category key to display name, in the current language. */
export function starterCategoryNames(t: Translate): Record<string, string> {
  return Object.fromEntries(KEYS.map((key) => [key, t(`starter.category.${key}`)]));
}

export const starterFoldName = (t: Translate): string => t('starter.fold.personal');
