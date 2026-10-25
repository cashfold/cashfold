// Names are ordered in `core` by character code on purpose (a query gives the same answer whoever asks). What a person reads should follow their
// language instead: Polish puts Ł after L and Ukrainian puts Ї after І. The lists the person ordered themselves (accounts, categories) are left
// as they are; only the lists ordered by name are re-ordered here, for display.

export const collatorFor = (locale: string): Intl.Collator => new Intl.Collator(locale, { sensitivity: 'variant', numeric: true });

/** Sorted by name in the language, with the original order (core's, by id) deciding ties. */
export function sortedByName<T extends { readonly name: string }>(items: readonly T[], locale: string): T[] {
  const collator = collatorFor(locale);
  return items.map((item, index) => ({ item, index })).sort((a, b) => collator.compare(a.item.name, b.item.name) || a.index - b.index).map(({ item }) => item);
}

/**
 * Text reduced to what a person types on any keyboard: lower case, accents removed, `ł` as `l`. Finding is deliberately more forgiving than the
 * sort order: someone without Polish or Ukrainian letters types `lodz` for `Łódź`, or `i` for `Їжа`, and should still find it.
 */
export const foldLetters = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[łŁ]/g, 'l').toLowerCase();

/** Does `name` contain `query`, ignoring case and accents? An empty query matches everything. */
export const includesLetters = (name: string, query: string): boolean => foldLetters(name).includes(foldLetters(query.trim()));
