// The route table (contracts/routes.md): the five primary sections, the settings groups, and the redirects from the previous addresses.
// Pure data and helpers, so the shell, the redirect stubs and the tests share one source.
export type SectionId = 'overview' | 'transactions' | 'accounts' | 'plan' | 'settings';
export type SettingsGroupId = 'profile' | 'appearance' | 'categories' | 'sync' | 'data' | 'folds' | 'advanced' | 'desktop' | 'install';

export interface Section {
  readonly id: SectionId;
  readonly labelKey: string;
  readonly href: string;
  /** Which Heroicon the shell draws (outline set in the contract; the kit re-exports the solid 20px ones). */
  readonly icon: 'home' | 'transactions' | 'accounts' | 'plan' | 'settings';
}

export const PRIMARY_SECTIONS: readonly Section[] = [
  { id: 'overview', labelKey: 'nav.overview', href: '/overview/', icon: 'home' },
  { id: 'transactions', labelKey: 'nav.transactions', href: '/transactions/', icon: 'transactions' },
  { id: 'accounts', labelKey: 'nav.accounts', href: '/accounts/', icon: 'accounts' },
  { id: 'plan', labelKey: 'nav.plan', href: '/plan/', icon: 'plan' },
  { id: 'settings', labelKey: 'nav.settings', href: '/settings/', icon: 'settings' },
];

export interface SettingsGroup {
  readonly id: SettingsGroupId;
  readonly href: string;
  readonly labelKey: string;
  readonly descriptionKey: string;
}

const group = (id: SettingsGroupId): SettingsGroup => ({ id, href: `/settings/${id}/`, labelKey: `settings.group.${id}`, descriptionKey: `settings.group.${id}.description` });
export const SETTINGS_GROUPS: readonly SettingsGroup[] = (['profile', 'appearance', 'categories', 'sync', 'data', 'folds', 'advanced'] as const).map(group);

/** The group only the desktop app has (spec 006). It is not one of the seven everyone sees; the page sends a browser to the Settings index. */
export const DESKTOP_SETTINGS_GROUP: SettingsGroup = group('desktop');

/** The group that offers to install the web app (spec 009). Listed only where installing can help; the page sends everyone else to the Settings index. */
export const INSTALL_SETTINGS_GROUP: SettingsGroup = group('install');

/** Every page that renders its own screen. Old addresses are not in this set: they only redirect. */
export const ROUTES: ReadonlySet<string> = new Set([...PRIMARY_SECTIONS.map((s) => s.href), ...SETTINGS_GROUPS.map((g) => g.href), INSTALL_SETTINGS_GROUP.href]);

export const REDIRECTS: readonly { readonly from: string; readonly to: string }[] = [
  { from: '/dashboard/', to: '/overview/' },
  { from: '/transfers/', to: '/transactions/?new=transfer' },
  { from: '/budgets/', to: '/plan/?view=budgets' },
  { from: '/goals/', to: '/plan/?view=goals' },
  { from: '/schedules/', to: '/plan/?view=schedules' },
  { from: '/categories/', to: '/settings/categories/' },
  { from: '/data/', to: '/settings/data/' },
  { from: '/devices/', to: '/settings/sync/' },
  { from: '/folds/', to: '/settings/folds/' },
];

const withSlash = (pathname: string): string => pathname.replace(/\/?$/, '/');

/** Where an old address now lives, keeping the query of the old address (the target's own query comes first). */
export function redirectTarget(pathname: string, search: string): string | undefined {
  const entry = REDIRECTS.find((r) => r.from === withSlash(pathname));
  if (!entry) return undefined;
  const [path, ownQuery = ''] = entry.to.split('?') as [string, string?];
  const query = [ownQuery, search.replace(/^\?/, '')].filter(Boolean).join('&');
  return query === '' ? path : `${path}?${query}`;
}

/** The primary section a path belongs to: its own route and every sub-route. */
export function matchSection(pathname: string): SectionId | undefined {
  const path = withSlash(pathname);
  return PRIMARY_SECTIONS.find((s) => path === s.href || path.startsWith(s.href))?.id;
}
