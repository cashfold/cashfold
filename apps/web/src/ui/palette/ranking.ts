import type { HistoryItem } from './history';
import type { PaletteEntry } from './entry';
import type { Section } from './CommandPalette';
import type { Result } from './search';

// What the palette shows before anything is typed (spec 015, research R6): Recent, then Frequent, or the main screens and common actions when there is no
// history yet. Only entries that exist now are listed: one that was deleted, belongs to another Fold or is not available is skipped, never shown.

export const RECENT_COUNT = 5;
export const FREQUENT_COUNT = 5;
/** The screens shown when there is nothing to remember yet. */
export const MAIN_SCREEN_IDS = ['c:go-overview', 'c:go-transactions', 'c:go-accounts', 'c:go-plan', 'c:go-settings'] as const;

export interface EmptyQueryHeadings {
  readonly recent: string;
  readonly frequent: string;
  readonly screen: string;
  readonly action: string;
}

const row = (entry: PaletteEntry): Result => ({ entry, title: undefined, score: 0 });

export function emptyQuerySections(entries: readonly PaletteEntry[], history: readonly HistoryItem[], headings: EmptyQueryHeadings): Section[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const live = history.filter((item) => byId.has(item.id));
  const recent = [...live].sort((a, b) => b.t - a.t || b.n - a.n).slice(0, RECENT_COUNT);
  const shown = new Set(recent.map((item) => item.id));
  const frequent = [...live]
    .filter((item) => !shown.has(item.id))
    .sort((a, b) => b.n - a.n || b.t - a.t)
    .slice(0, FREQUENT_COUNT);

  const sections: Section[] = [];
  if (recent.length > 0) sections.push({ key: 'recent', heading: headings.recent, rows: recent.map((item) => row(byId.get(item.id)!)) });
  if (frequent.length > 0) sections.push({ key: 'frequent', heading: headings.frequent, rows: frequent.map((item) => row(byId.get(item.id)!)) });
  if (sections.length > 0) return sections;

  const screens = MAIN_SCREEN_IDS.map((id) => byId.get(id)).filter((e): e is PaletteEntry => e !== undefined);
  const actions = entries.filter((entry) => entry.type === 'action');
  if (screens.length > 0) sections.push({ key: 'screen', heading: headings.screen, rows: screens.map(row) });
  if (actions.length > 0) sections.push({ key: 'action', heading: headings.action, rows: actions.map(row) });
  return sections;
}

/** Entry id to use count, for ordering equally good matches. */
export function usageOf(history: readonly HistoryItem[]): Map<string, number> {
  return new Map(history.map((item) => [item.id, item.n]));
}
