import IntlMessageFormat from 'intl-messageformat';
import type { Catalog } from './i18n';

// The rules a translated catalogue must meet (specs/004-ukrainian-polish-languages/contracts/catalogue-contract.md). Used by the unit test that
// blocks a merge when Ukrainian or Polish lacks a message, uses other placeholders than English, or leaves out a plural form.

export type Rule = 2 | 3 | 4 | 5 | 6 | 9;
export interface Violation {
  readonly language: string;
  readonly key: string;
  readonly rule: Rule;
  readonly detail: string;
}

// ICU element types, as in @formatjs/icu-messageformat-parser.
const ARGUMENT = 1, NUMBER = 2, DATE = 3, TIME = 4, SELECT = 5, PLURAL = 6, TAG = 8;

interface Ast {
  type: number;
  value?: string;
  options?: Record<string, { value: Ast[] }>;
  children?: Ast[];
}

interface Shape {
  readonly args: Set<string>;
  readonly tags: Set<string>;
  /** Plural argument name to the selectors written for it. */
  readonly plurals: Map<string, Set<string>>;
}

function shapeOf(source: string, locale: string): Shape {
  const shape: Shape = { args: new Set(), tags: new Set(), plurals: new Map() };
  const walk = (nodes: readonly Ast[]): void => {
    for (const node of nodes) {
      if ([ARGUMENT, NUMBER, DATE, TIME, SELECT, PLURAL].includes(node.type) && node.value !== undefined) shape.args.add(node.value);
      if (node.type === TAG && node.value !== undefined) {
        shape.tags.add(node.value);
        walk(node.children ?? []);
      }
      if ((node.type === PLURAL || node.type === SELECT) && node.options !== undefined) {
        if (node.type === PLURAL && node.value !== undefined) shape.plurals.set(node.value, new Set(Object.keys(node.options)));
        for (const option of Object.values(node.options)) walk(option.value);
      }
    }
  };
  walk(new IntlMessageFormat(source, locale).getAst() as unknown as Ast[]);
  return shape;
}

/** The argument names of a message, and which of them are counts (plural), so a test can format it with sample values. */
export function argumentsOf(source: string, locale: string): { readonly all: ReadonlySet<string>; readonly counts: ReadonlySet<string> } {
  const shape = shapeOf(source, locale);
  return { all: shape.args, counts: new Set(shape.plurals.keys()) };
}

const same = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

/** The plural categories a language can reach, which a plural message must therefore cover. */
export const pluralCategories = (language: string): string[] => new Intl.PluralRules(language).resolvedOptions().pluralCategories;

export interface CheckOptions {
  /** Keys whose value may equal the English text (the brand, codes, symbols). */
  readonly identicalAllowed?: ReadonlySet<string>;
  /** Keys that only English needs (none today). */
  readonly englishOnly?: ReadonlySet<string>;
  /** Keys that must exist as `starter.category.<key>` for every default category (rule 9). */
  readonly starterCategoryKeys?: readonly string[];
}

export function checkCatalogue(language: string, english: Catalog, catalogue: Catalog, options: CheckOptions = {}): Violation[] {
  const out: Violation[] = [];
  const add = (key: string, rule: Rule, detail: string): number => out.push({ language, key, rule, detail });
  const englishOnly = options.englishOnly ?? new Set<string>();

  for (const key of Object.keys(english)) if (!(key in catalogue) && !englishOnly.has(key)) add(key, 2, 'missing in this language');
  for (const key of Object.keys(catalogue)) if (!(key in english)) add(key, 2, 'not in English (extra key)');

  const needed = pluralCategories(language);
  for (const [key, value] of Object.entries(catalogue)) {
    const source = english[key];
    if (source === undefined) continue;
    if (typeof value !== 'string') {
      add(key, 3, 'value is not a string');
      continue;
    }
    let mine: Shape;
    try {
      mine = shapeOf(value, language);
    } catch (error) {
      add(key, 3, `does not parse: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const theirs = shapeOf(source, 'en');
    if (!same(mine.args, theirs.args)) add(key, 4, `arguments {${[...mine.args].sort().join(', ')}} differ from English {${[...theirs.args].sort().join(', ')}}`);
    if (!same(mine.tags, theirs.tags)) add(key, 4, `tags <${[...mine.tags].sort().join(', ')}> differ from English <${[...theirs.tags].sort().join(', ')}>`);
    for (const [arg] of theirs.plurals) {
      const selectors = mine.plurals.get(arg);
      if (selectors === undefined) {
        add(key, 5, `English pluralises {${arg}} but this message does not`);
        continue;
      }
      if (!selectors.has('other')) add(key, 5, `plural {${arg}} has no "other"`);
      for (const category of needed) if (!selectors.has(category)) add(key, 5, `plural {${arg}} has no "${category}" form, which ${language} needs`);
    }
    if (value === source && !(options.identicalAllowed ?? new Set()).has(key)) add(key, 6, 'identical to English (untranslated)');
  }

  for (const key of options.starterCategoryKeys ?? []) if (!(`starter.category.${key}` in catalogue)) add(`starter.category.${key}`, 9, 'no starter name for this default category');
  if (!('starter.fold.personal' in catalogue)) add('starter.fold.personal', 9, 'no starter name for the personal Fold');
  return out;
}

export const describeViolations = (violations: readonly Violation[]): string =>
  violations.map((v) => `[${v.language}] rule ${v.rule}: ${v.key} — ${v.detail}`).join('\n');
