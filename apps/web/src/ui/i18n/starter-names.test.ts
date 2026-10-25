import { defaultCategories } from '@cashfold/core';
import { describe, expect, it } from 'vitest';
import { createTranslator, ENGLISH } from './i18n';
import { starterCategoryNames, starterFoldName } from './starter-names';

describe('starter names (FR-015)', () => {
  const keys = defaultCategories('00000000-0000-4000-8000-000000000000' as never).map((c) => c.key);

  it('has a name in the catalogue for every default category and for the personal Fold', () => {
    for (const key of keys) expect(ENGLISH[`starter.category.${key}`], key).toBeTypeOf('string');
    expect(ENGLISH['starter.fold.personal']).toBe('Personal');
  });

  it('in English gives exactly the names core already uses', () => {
    const names = starterCategoryNames(createTranslator('en'));
    for (const c of defaultCategories('00000000-0000-4000-8000-000000000000' as never)) expect(names[c.key], c.key).toBe(c.name);
    expect(starterFoldName(createTranslator('en'))).toBe('Personal');
  });

  it('in another language uses that language, and English for what it lacks', () => {
    const t = createTranslator('pl', { en: ENGLISH, pl: { 'starter.fold.personal': 'Osobisty', 'starter.category.expense.food': 'Jedzenie i napoje' } });
    expect(starterFoldName(t)).toBe('Osobisty');
    const names = starterCategoryNames(t);
    expect(names['expense.food']).toBe('Jedzenie i napoje');
    expect(names['expense.home']).toBe('Home');
  });
});
