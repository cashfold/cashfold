import type { PaletteContext } from './registry';

/** What a row in the palette is. Screens and actions come from the registry; the other three are the person's own items in the viewed Fold. */
export type EntryType = 'screen' | 'action' | 'account' | 'envelope' | 'goal';

/** The order the groups appear in, and the tie-break between equally good matches. */
export const TYPE_ORDER: Readonly<Record<EntryType, number>> = { screen: 0, action: 1, account: 2, envelope: 3, goal: 4 };

/**
 * One selectable row. Built each time the palette opens from data already in memory, and never stored (data-model.md §1). The id is opaque and is the only
 * thing the history keeps: `a:`, `e:` and `g:` for an account, a budget (the envelope of the spec) and a goal, `c:` for a registered command.
 */
export interface PaletteEntry {
  readonly id: string;
  readonly type: EntryType;
  readonly title: string;
  /** A short line that tells apart items with the same name. */
  readonly secondary?: string;
  /** Extra words that should match, already translated. Never shown. */
  readonly keywords: readonly string[];
  run(ctx: PaletteContext): void;
}
