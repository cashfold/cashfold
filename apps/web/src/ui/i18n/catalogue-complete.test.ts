import { describe, expect, it } from 'vitest';
import { defaultCategories } from '@cashfold/core';
import { checkCatalogue, describeViolations, pluralCategories } from './catalogue-check';
import { ENGLISH, loadCatalogue } from './i18n';

// FR-013: a message that lacks a Ukrainian or Polish text, uses other placeholders than English, or leaves out a plural form must fail the build.

/** Languages whose real files are still being drafted are skipped; the list is emptied when the drafts are in (tasks T030). */
const PENDING_LANGUAGES: readonly string[] = [];

/** Keys whose text is the same in every language: names, codes, symbols. Anything else equal to English is a missed translation. */
const IDENTICAL_ALLOWED = new Set<string>([
  // names and codes
  'app.name', 'locale.en', 'locale.ar', 'settings.about.os.win32', 'settings.about.os.darwin', 'settings.about.os.linux', 'settings.about.packaging.appimage',
  // nothing but placeholders and symbols
  'schedules.transferAmount', 'goals.percentValue', 'settings.about.systemValue',
  // words that happen to be the same in Polish
  'ledger.tx.status', 'ledger.filter.status', 'field.tx.status', 'ledger.color.6', 'ledger.icon.bus', 'ledger.icon.landmark', 'budgets.mode.limit', 'budgets.form.limit',
  'nav.plan', 'page.plan.title', 'plan.title', 'settings.about.system', 'starter.category.expense.transport', 'starter.category.expense.transport.parking',
  'starter.category.expense.health.fitness', 'unit.kb', 'unit.mb', 'unit.gb',
]);

const STARTER_KEYS = defaultCategories('f0000000-0000-4000-8000-000000000000' as never).map((c) => c.key);

describe.each(['uk', 'pl'])('the %s catalogue meets the contract', (language) => {
  it.skipIf(PENDING_LANGUAGES.includes(language))('has every key, the same placeholders, every plural form and a real translation', async () => {
    const violations = checkCatalogue(language, ENGLISH, await loadCatalogue(language), { identicalAllowed: IDENTICAL_ALLOWED, starterCategoryKeys: STARTER_KEYS });
    expect(describeViolations(violations)).toBe('');
  });
});

describe('the check itself (US3)', () => {
  const en = {
    greet: 'Hello {name}',
    files: '{count, plural, one {# file} other {# files}}',
    link: 'Read <a>the guide</a>',
    brand: 'Cashfold',
    'starter.fold.personal': 'Personal',
  };
  const good = {
    greet: 'Cześć {name}',
    files: '{count, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}',
    link: 'Przeczytaj <a>poradnik</a>',
    brand: 'Cashfold',
    'starter.fold.personal': 'Osobisty',
  };
  const run = (catalogue: Record<string, string>) => checkCatalogue('pl', en, catalogue, { identicalAllowed: new Set(['brand']) });
  const rules = (catalogue: Record<string, string>) => run(catalogue).map((v) => `${v.rule}:${v.key}`);

  it('passes a complete translation', () => {
    expect(run(good)).toEqual([]);
  });

  it('rule 2: names a missing key and an extra key', () => {
    const missing: Record<string, string> = { ...good };
    delete missing['greet'];
    expect(rules(missing)).toContain('2:greet');
    expect(rules({ ...good, extra: 'x' })).toContain('2:extra');
  });

  it('rule 3: names a message that does not parse', () => {
    expect(rules({ ...good, files: '{count, plural, one {# plik}' })).toContain('3:files');
  });

  it('rule 4: names a renamed argument and a missing tag', () => {
    expect(rules({ ...good, greet: 'Cześć {imię}' })).toContain('4:greet');
    expect(rules({ ...good, link: 'Przeczytaj poradnik' })).toContain('4:link');
  });

  it('rule 5: names a plural without "few" or "many", or not a plural at all (a plural with no "other" does not parse, rule 3)', () => {
    expect(rules({ ...good, files: '{count, plural, one {# plik} few {# pliki} many {# plików}}' })).toContain('3:files');
    expect(run({ ...good, files: '{count, plural, one {# plik} other {# plików}}' }).map((v) => v.detail).join('\n')).toMatch(/no "few" form/);
    expect(rules({ ...good, files: '{count} plików' })).toContain('5:files');
  });

  it('rule 6: names a value left identical to English, unless it is allowed', () => {
    expect(rules({ ...good, greet: 'Hello {name}' })).toContain('6:greet');
    expect(rules({ ...good, brand: 'Cashfold' })).not.toContain('6:brand');
  });

  it('rule 9: names a missing starter name', () => {
    const without: Record<string, string> = { ...good };
    delete without['starter.fold.personal'];
    expect(checkCatalogue('pl', { ...en, 'starter.fold.personal': 'Personal' }, without, { identicalAllowed: new Set(['brand']) }).map((v) => v.rule)).toContain(9);
  });

  it('the language needs one, few, many and other (Ukrainian and Polish)', () => {
    expect(pluralCategories('uk').sort()).toEqual(['few', 'many', 'one', 'other']);
    expect(pluralCategories('pl').sort()).toEqual(['few', 'many', 'one', 'other']);
    expect(pluralCategories('en').sort()).toEqual(['one', 'other']);
  });
});
