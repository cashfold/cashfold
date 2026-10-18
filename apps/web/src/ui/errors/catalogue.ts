import IntlMessageFormat from 'intl-messageformat';

// The only place an error becomes text for a person (FR-098). An error is reduced to its kind plus a few
// parameters that cannot hold content: a retry delay, a role, a feature name from a closed list, a count.
// Message text, amounts, names, notes and key material are never read from the error, so they cannot reach the
// screen, a log or a screen reader by accident. Kinds mirror the error taxonomy in contracts/core-api.md.

export const ERROR_KINDS = [
  'InvalidAmount', 'AmountOutOfRange', 'CurrencyMismatch', 'ArchivedAccount', 'InvariantViolation', 'NotFound',
  'PermissionDenied', 'Locked', 'AuthFailed', 'RateLimited', 'ServerRejected', 'ServerTampering', 'KdfBelowFloor',
  'Offline', 'Conflict', 'Storage', 'UnsupportedBrowser', 'OwnsSharedFold', 'AccountDeleted', 'EmailNotVerified',
  'LookupRateLimited', 'Cancelled',
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];
export type Severity = 'info' | 'warning' | 'error';
export type Role = 'owner' | 'editor' | 'viewer';

const FEATURES = ['secure_context', 'opfs', 'webcrypto', 'workers', 'wasm', 'locks', 'broadcast'] as const;
const ROLES: readonly Role[] = ['owner', 'editor', 'viewer'];

/** What callers may pass in. Extra properties are accepted at runtime but never read. */
export type AppError =
  | { readonly kind: Exclude<ErrorKind, 'PermissionDenied' | 'RateLimited' | 'LookupRateLimited' | 'UnsupportedBrowser' | 'OwnsSharedFold'> }
  | { readonly kind: 'PermissionDenied'; readonly roleRequired: Role }
  | { readonly kind: 'RateLimited' | 'LookupRateLimited'; readonly retryAfter: number }
  | { readonly kind: 'UnsupportedBrowser'; readonly feature: (typeof FEATURES)[number] }
  | { readonly kind: 'OwnsSharedFold'; readonly folds: readonly unknown[] };

export interface ErrorParams {
  retryAfter?: number;
  roleRequired?: Role;
  feature?: string;
  count?: number;
}

export interface ErrorDescription {
  /** Message key, `error.<Kind>`; `error.unknown` for anything not in the catalogue. */
  readonly key: string;
  readonly params: ErrorParams;
  readonly severity: Severity;
}

export const MESSAGES_EN: Readonly<Record<string, string>> = {
  'error.InvalidAmount': "That amount isn't valid. Use digits, and no more decimal places than the currency allows.",
  'error.AmountOutOfRange': 'That amount is too large for the app to store.',
  'error.CurrencyMismatch': "The currencies don't match. Convert the amount first.",
  'error.ArchivedAccount': 'This account is archived. Restore it to add entries.',
  'error.InvariantViolation': "That change would break a rule of your ledger, so it wasn't saved.",
  'error.NotFound': "We couldn't find that item. It may have been deleted.",
  'error.PermissionDenied': "Your role in this Fold doesn't allow that. It needs the {roleRequired, select, owner {owner} editor {editor} viewer {viewer} other {a higher}} role.",
  'error.Locked': 'The app is locked. Unlock it to continue.',
  'error.AuthFailed': "We couldn't sign you in with those details. Check them and try again.",
  'error.RateLimited': 'Too many attempts. Try again in {retryAfter, plural, one {# second} other {# seconds}}.',
  'error.ServerRejected': "The service didn't accept that request. Your data on this device is safe.",
  'error.ServerTampering': 'The service sent data that failed our safety checks, so it was ignored. Your data on this device is safe.',
  'error.KdfBelowFloor': "This account's security settings are weaker than the app allows, so it was not opened.",
  'error.Offline': "You're offline. Changes are saved on this device and will sync when you're back online.",
  'error.Conflict': 'This was changed somewhere else at the same time. Review it and try again.',
  'error.Storage': "This device couldn't save your data. Free up space or check your browser settings.",
  'error.UnsupportedBrowser': "This browser doesn't support {feature, select, secure_context {a secure connection} opfs {private storage} webcrypto {secure encryption} workers {background tasks} wasm {WebAssembly} locks {tab coordination} broadcast {tab coordination} other {a required feature}}. Try a current version of Chrome, Edge, Firefox or Safari.",
  'error.OwnsSharedFold': 'You own {count, plural, one {# shared Fold} other {# shared Folds}}. Transfer or delete {count, plural, one {it} other {them}} first.',
  'error.AccountDeleted': 'This account was deleted, and its data has been removed from this device.',
  'error.EmailNotVerified': 'Verify your email address to continue.',
  'error.LookupRateLimited': "You've looked up too many people for now. Try again in {retryAfter, plural, one {# second} other {# seconds}}.",
  'error.Cancelled': 'The action was cancelled.',
  'error.unknown': 'Something went wrong. Your data is safe on this device. Try again.',
};

const SEVERITY: Readonly<Record<ErrorKind, Severity>> = {
  InvalidAmount: 'warning', AmountOutOfRange: 'warning', CurrencyMismatch: 'warning', ArchivedAccount: 'warning', InvariantViolation: 'warning',
  NotFound: 'warning', PermissionDenied: 'warning', Locked: 'info', AuthFailed: 'warning', RateLimited: 'warning', ServerRejected: 'error',
  ServerTampering: 'error', KdfBelowFloor: 'error', Offline: 'info', Conflict: 'warning', Storage: 'error', UnsupportedBrowser: 'error',
  OwnsSharedFold: 'warning', AccountDeleted: 'error', EmailNotVerified: 'info', LookupRateLimited: 'warning', Cancelled: 'info',
};

const isKind = (kind: unknown): kind is ErrorKind => typeof kind === 'string' && (ERROR_KINDS as readonly string[]).includes(kind);

function paramsFor(error: Record<string, unknown>, kind: ErrorKind): ErrorParams {
  switch (kind) {
    case 'RateLimited':
    case 'LookupRateLimited': {
      const v = error['retryAfter'];
      return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 86_400 * 365 ? { retryAfter: v } : {};
    }
    case 'PermissionDenied': {
      const v = error['roleRequired'];
      return typeof v === 'string' && (ROLES as readonly string[]).includes(v) ? { roleRequired: v as Role } : {};
    }
    case 'UnsupportedBrowser': {
      const v = error['feature'];
      return { feature: typeof v === 'string' && (FEATURES as readonly string[]).includes(v) ? v : 'other' };
    }
    case 'OwnsSharedFold': {
      const folds = error['folds'];
      return { count: Array.isArray(folds) ? folds.length : 1 };
    }
    default:
      return {};
  }
}

/** Reduces an error to a message key, validated parameters and a severity. Everything else is ignored. */
export function describeError(error: AppError): ErrorDescription {
  const raw = error as unknown as Record<string, unknown>;
  const kind = raw['kind'];
  if (!isKind(kind)) return { key: 'error.unknown', params: {}, severity: 'error' };
  return { key: `error.${kind}`, params: paramsFor(raw, kind), severity: SEVERITY[kind] };
}

/** Plain-language text for an error in the given locale (English until more catalogues are added). */
export function formatError(error: AppError, locale = 'en', messages: Readonly<Record<string, string>> = MESSAGES_EN): string {
  const { key, params } = describeError(error);
  const template = messages[key] ?? MESSAGES_EN[key] ?? MESSAGES_EN['error.unknown']!;
  try {
    return String(new IntlMessageFormat(template, locale).format(params as Record<string, string | number>));
  } catch {
    return MESSAGES_EN['error.unknown']!;
  }
}
