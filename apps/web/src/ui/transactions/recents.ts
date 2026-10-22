// What the add form remembers between visits (FR-022): the account last used in each Fold and the categories used most recently. Ids only,
// device-local (ui/prefs), validated against the Fold's current lists every time they are used.
import type { Prefs } from '../prefs/schema';

export const MAX_RECENT_CATEGORIES = 8;

interface AccountLike {
  id: string;
  archived?: boolean;
  kind?: string;
}
interface CategoryLike {
  id: string;
  parentId: string | null;
  archived?: boolean;
}

/** The account to preselect: the one last used in this Fold if it is still usable, otherwise the first ordinary account. */
export function pickDefaultAccount(prefs: Pick<Prefs, 'recents'>, foldId: string, accounts: readonly AccountLike[]): string | undefined {
  const usable = accounts.filter((a) => a.archived !== true);
  const remembered = prefs.recents.account[foldId];
  if (remembered !== undefined && usable.some((a) => a.id === remembered)) return remembered;
  return (usable.find((a) => a.kind !== 'goal') ?? usable[0])?.id;
}

export interface OrderedCategories<C extends CategoryLike> {
  recent: C[];
  groups: { root: C; children: C[] }[];
}

/** Recent categories first (newest first), then every parent with its children. Unknown and archived ids are ignored. */
export function orderCategories<C extends CategoryLike>(recentIds: readonly string[], categories: readonly C[], keepArchivedId?: string | null): OrderedCategories<C> {
  const usable = categories.filter((c) => c.archived !== true || c.id === keepArchivedId);
  const recent = recentIds.map((id) => usable.find((c) => c.id === id)).filter((c): c is C => c !== undefined);
  const roots = usable.filter((c) => c.parentId === null);
  return { recent, groups: roots.map((root) => ({ root, children: usable.filter((c) => c.parentId === root.id) })) };
}

/** The recents after an entry is saved: its account, and its category moved to the front. */
export function recordRecents(recents: Prefs['recents'], foldId: string, accountId: string, categoryId: string | null): Prefs['recents'] {
  const next: Prefs['recents'] = { account: { ...recents.account, [foldId]: accountId }, categories: { ...recents.categories } };
  if (categoryId !== null) next.categories[foldId] = [categoryId, ...(recents.categories[foldId] ?? []).filter((id) => id !== categoryId)].slice(0, MAX_RECENT_CATEGORIES);
  return next;
}

/** Drops remembered ids that no longer exist in the Fold. */
export function pruneRecents(recents: Prefs['recents'], foldId: string, accountIds: ReadonlySet<string>, categoryIds: ReadonlySet<string>): Prefs['recents'] {
  const account = { ...recents.account };
  const remembered = account[foldId];
  if (remembered !== undefined && !accountIds.has(remembered)) delete account[foldId];
  const categories = { ...recents.categories };
  const list = categories[foldId];
  if (list !== undefined) categories[foldId] = list.filter((id) => categoryIds.has(id));
  return { account, categories };
}
