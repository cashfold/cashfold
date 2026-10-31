// Interface preferences (data-model §1): one JSON object in localStorage under `cashfold.ui`, device-local, never synced or exported.
// Parsing is defensive field by field: unknown keys are dropped and an invalid value falls back to its default without touching the rest.
import { DEFAULT_PRIMARY, parsePrimary, type PrimaryChoice } from '../theme/palette';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type PeriodKind = 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear' | 'last30' | 'last90' | 'all';
export type PeriodChoice = { kind: PeriodKind } | { kind: 'custom'; from: string; to: string };
export type OverviewSectionId = 'category' | 'tag' | 'trend' | 'balance' | 'accounts';
export type PlanView = 'budgets' | 'goals' | 'schedules';
/** `auto` is "never chosen": the Accounts page opens by group once an account is in a group. */
export type AccountsViewChoice = 'auto' | 'group' | 'type';
/** `auto` follows the browser's languages; the others are the person's own choice. */
export const LANGUAGE_CHOICES = ['auto', 'en', 'uk', 'pl'] as const;
export type LanguageChoice = (typeof LANGUAGE_CHOICES)[number];
/** `auto` is "never chosen": it follows the older show-amounts choice, so a person who allowed amounts keeps details on (spec 016). */
export const NOTIFICATION_DETAIL_CHOICES = ['auto', 'on', 'off'] as const;
export type NotificationDetailChoice = (typeof NOTIFICATION_DETAIL_CHOICES)[number];

export interface Prefs {
  v: 1;
  theme: ThemeChoice;
  /** The primary colour (spec 014): an id from the palette. */
  primary: PrimaryChoice;
  language: LanguageChoice;
  /** Mask money amounts on screen until one is revealed (spec 016). Device-local, never synced. */
  privacyMode: boolean;
  /** Whether notifications include the schedule's name and day (spec 016). */
  notificationDetails: NotificationDetailChoice;
  moreDetailsOpen: boolean;
  optionalFields: Record<string, boolean>;
  overview: { period: PeriodChoice; collapsed: OverviewSectionId[] };
  plan: { view: PlanView };
  recents: { account: Record<string, string>; categories: Record<string, string[]> };
  hints: { dismissed: string[] };
  firstRun: { dismissed: boolean };
  lists: { showArchivedAccounts: boolean; accountsView: AccountsViewChoice };
}

export const PREFS_KEY = 'cashfold.ui';
export const MAX_PREFS_BYTES = 4096;
const MAX_CATEGORIES_PER_FOLD = 8;
const MAX_HINTS = 32;
const MAX_OPTIONAL_FIELDS = 64;
const MAX_FOLDS = 16;
const MAX_ID = 64;

const PERIOD_KINDS: readonly PeriodKind[] = ['thisMonth', 'lastMonth', 'thisYear', 'lastYear', 'last30', 'last90', 'all'];
const SECTIONS: readonly OverviewSectionId[] = ['category', 'tag', 'trend', 'balance', 'accounts'];
const VIEWS: readonly PlanView[] = ['budgets', 'goals', 'schedules'];
const FIELD_ID = /^[a-z]{2}\.[a-zA-Z]+$/;

export const DEFAULT_PREFS: Prefs = {
  v: 1,
  theme: 'system',
  primary: DEFAULT_PRIMARY,
  language: 'auto',
  privacyMode: false,
  notificationDetails: 'auto',
  moreDetailsOpen: false,
  optionalFields: {},
  overview: { period: { kind: 'thisMonth' }, collapsed: [] },
  plan: { view: 'budgets' },
  recents: { account: {}, categories: {} },
  hints: { dismissed: [] },
  firstRun: { dismissed: false },
  lists: { showArchivedAccounts: false, accountsView: 'auto' },
};

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const bool = (x: unknown, fallback: boolean): boolean => (typeof x === 'boolean' ? x : fallback);
const oneOf = <T extends string>(x: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(x as T) ? (x as T) : fallback);
const idString = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_ID;

/** A real calendar date in `YYYY-MM-DD` form (month lengths and leap years respected). */
export function isIsoDate(x: unknown): x is string {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const [y, m, d] = x.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function parsePeriod(x: unknown): PeriodChoice {
  if (!isRecord(x)) return DEFAULT_PREFS.overview.period;
  if (x['kind'] === 'custom') {
    const { from, to } = x;
    return isIsoDate(from) && isIsoDate(to) && from <= to ? { kind: 'custom', from, to } : DEFAULT_PREFS.overview.period;
  }
  return PERIOD_KINDS.includes(x['kind'] as PeriodKind) ? { kind: x['kind'] as PeriodKind } : DEFAULT_PREFS.overview.period;
}

function parseRecord<T>(x: unknown, valid: (v: unknown) => T | undefined, max: number): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isRecord(x)) return out;
  for (const [key, value] of Object.entries(x)) {
    if (Object.keys(out).length >= max) break;
    const v = valid(value);
    if (idString(key) && v !== undefined) out[key] = v;
  }
  return out;
}

export function parsePrefs(raw: string | null | undefined): Prefs {
  let data: unknown;
  try {
    data = typeof raw === 'string' && raw !== '' ? JSON.parse(raw) : undefined;
  } catch {
    return structuredClone(DEFAULT_PREFS);
  }
  // A higher version was written by a newer build: use the defaults and let nothing be rewritten until the person changes a setting.
  if (!isRecord(data) || data['v'] !== 1) return structuredClone(DEFAULT_PREFS);

  const optionalFields: Record<string, boolean> = {};
  if (isRecord(data['optionalFields'])) {
    for (const [id, value] of Object.entries(data['optionalFields'])) {
      if (Object.keys(optionalFields).length >= MAX_OPTIONAL_FIELDS) break;
      if (FIELD_ID.test(id) && typeof value === 'boolean') optionalFields[id] = value;
    }
  }
  const overview = isRecord(data['overview']) ? data['overview'] : {};
  const collapsed = Array.isArray(overview['collapsed']) ? [...new Set(overview['collapsed'].filter((s): s is OverviewSectionId => SECTIONS.includes(s as OverviewSectionId)))] : [];
  const recents = isRecord(data['recents']) ? data['recents'] : {};
  const hints = isRecord(data['hints']) ? data['hints'] : {};
  const dismissed = Array.isArray(hints['dismissed']) ? [...new Set(hints['dismissed'].filter((h): h is string => typeof h === 'string' && h.length > 0 && h.length <= 40))].slice(0, MAX_HINTS) : [];

  return {
    v: 1,
    theme: oneOf(data['theme'], ['system', 'light', 'dark'] as const, 'system'),
    primary: parsePrimary(data['primary']),
    language: oneOf(data['language'], LANGUAGE_CHOICES, 'auto'),
    privacyMode: bool(data['privacyMode'], false),
    notificationDetails: oneOf(data['notificationDetails'], NOTIFICATION_DETAIL_CHOICES, 'auto'),
    moreDetailsOpen: bool(data['moreDetailsOpen'], false),
    optionalFields,
    overview: { period: parsePeriod(overview['period']), collapsed },
    plan: { view: oneOf(isRecord(data['plan']) ? data['plan']['view'] : undefined, VIEWS, 'budgets') },
    recents: {
      account: parseRecord(recents['account'], (v) => (idString(v) ? v : undefined), MAX_FOLDS),
      categories: parseRecord(recents['categories'], (v) => (Array.isArray(v) ? v.filter(idString).slice(0, MAX_CATEGORIES_PER_FOLD) : undefined), MAX_FOLDS),
    },
    hints: { dismissed },
    firstRun: { dismissed: bool(isRecord(data['firstRun']) ? data['firstRun']['dismissed'] : undefined, false) },
    lists: {
      showArchivedAccounts: bool(isRecord(data['lists']) ? data['lists']['showArchivedAccounts'] : undefined, false),
      accountsView: oneOf(isRecord(data['lists']) ? data['lists']['accountsView'] : undefined, ['auto', 'group', 'type'] as const, 'auto'),
    },
  };
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/** JSON for storage, at most 4 KiB: the oldest recents (the tail of each newest-first list, then account entries) are dropped first. */
export function serializePrefs(prefs: Prefs): string {
  const copy = structuredClone(prefs);
  let text = JSON.stringify(copy);
  while (byteLength(text) > MAX_PREFS_BYTES) {
    const lists = Object.entries(copy.recents.categories).filter(([, ids]) => ids.length > 0).sort((a, b) => b[1].length - a[1].length);
    const longest = lists[0];
    const accounts = Object.keys(copy.recents.account);
    if (longest) longest[1].pop();
    else if (accounts.length > 0) delete copy.recents.account[accounts[0]!];
    else if (copy.hints.dismissed.length > 0) copy.hints.dismissed.pop();
    else {
      copy.optionalFields = {};
      text = JSON.stringify(copy);
      break;
    }
    text = JSON.stringify(copy);
  }
  return text;
}
