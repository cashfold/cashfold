import { z } from 'zod';

// Zod compiles object parsers with `new Function` when it can, and finds out by trying. The web app's Content-Security-Policy has no
// 'unsafe-eval', so even that probe is reported as a violation on every page that loads these schemas. The shapes are tiny: parse
// without compiling.
z.config({ jitless: true });

// The shapes that cross between the web app and the desktop shell (specs/003-desktop-apps-releases/contracts/desktop-bridge.md).
// Every object is strict: an unexpected key is an error, on both sides of the bridge.

const httpsUrl = z.url().refine((value) => URL.canParse(value) && new URL(value).protocol === 'https:', 'must be an https URL');

export const AboutInfoSchema = z.strictObject({
  /** The release version, equal to the tag without the leading "v". */
  version: z.string().min(1),
  /** The commit the web export was built from. */
  buildId: z.string().min(1),
  electron: z.string().min(1),
  chromium: z.string().min(1),
  os: z.enum(['win32', 'darwin', 'linux']),
  arch: z.enum(['x64', 'arm64']),
  packaging: z.enum(['nsis', 'dmg', 'appimage', 'deb', 'rpm', 'unpacked']),
  updateMode: z.enum(['in-app', 'manual']),
  signed: z.boolean(),
  /** Where the data lives, for display only; the renderer never supplies a path. */
  dataPath: z.string().min(1),
  /** The source of the running version. */
  sourceUrl: httpsUrl,
});
export type AboutInfo = z.infer<typeof AboutInfoSchema>;

export const UpdateModeSchema = z.enum(['in-app', 'manual']);
export const UpdateErrorCodeSchema = z.enum(['offline', 'verify-failed', 'download-failed', 'unknown']);

export const UpdateStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('idle') }),
  z.strictObject({ kind: z.literal('checking') }),
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('available'), version: z.string().min(1), notesUrl: httpsUrl, mode: UpdateModeSchema }),
  z.strictObject({ kind: z.literal('downloading'), version: z.string().min(1), percent: z.number().int().min(0).max(100) }),
  z.strictObject({ kind: z.literal('ready'), version: z.string().min(1) }),
  z.strictObject({ kind: z.literal('error'), code: UpdateErrorCodeSchema }),
]);
export type UpdateState = z.infer<typeof UpdateStateSchema>;

/** `cashfold:update:auto-check`: without `set` it reads the setting, with `set` it stores it. */
export const AutoCheckRequestSchema = z.strictObject({ set: z.boolean().optional() });
export type AutoCheckRequest = z.infer<typeof AutoCheckRequestSchema>;
export const AutoCheckResponseSchema = z.boolean();

/** `cashfold:language`: the languages the shell has words for. Anything else is refused. */
export const SHELL_LANGUAGES = ['en', 'uk', 'pl'] as const;
export const LanguageRequestSchema = z.strictObject({ language: z.enum(SHELL_LANGUAGES) });
export type LanguageRequest = z.infer<typeof LanguageRequestSchema>;
export type ShellLanguage = (typeof SHELL_LANGUAGES)[number];

// Desktop experience (specs/006-native-desktop-experience/contracts/desktop-bridge-additions.md).

export const DesktopSettingsSchema = z.strictObject({
  hideOnBlur: z.boolean(),
  startAtLogin: z.boolean(),
  closeBehavior: z.enum(['quit', 'background']),
  theme: z.enum(['system', 'light', 'dark']),
});
export type DesktopSettings = z.infer<typeof DesktopSettingsSchema>;

export const LOCK_REASONS = ['screen-lock', 'suspend', 'idle-state'] as const;

export const CapabilitiesSchema = z.strictObject({
  platform: z.enum(['win32', 'darwin', 'linux']),
  /** Which system events are expected to lock the app on this computer. */
  lockEvents: z.array(z.enum(LOCK_REASONS)).max(3),
  badge: z.boolean(),
  statusItem: z.boolean(),
  jumpList: z.boolean(),
  dockMenu: z.boolean(),
  notifications: z.enum(['granted', 'denied', 'unavailable']),
  translucency: z.enum(['active', 'unavailable', 'reduced']),
  loginItem: z.boolean(),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/** `cashfold:settings`: the stored preferences and the capability report together. */
export const SettingsResponseSchema = z.strictObject({ settings: DesktopSettingsSchema, capabilities: CapabilitiesSchema });
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

/** `cashfold:settings:set`: a change to one or more of the three person-controlled preferences. */
export const SettingsUpdateSchema = z
  .strictObject({
    hideOnBlur: z.boolean().optional(),
    startAtLogin: z.boolean().optional(),
    closeBehavior: z.enum(['quit', 'background']).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), 'at least one setting');
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;

export const SettingsSetResponseSchema = z.strictObject({
  settings: DesktopSettingsSchema,
  applied: z.strictObject({ startAtLogin: z.boolean() }),
});
export type SettingsSetResponse = z.infer<typeof SettingsSetResponseSchema>;

export const ThemeRequestSchema = z.strictObject({ theme: z.enum(['system', 'light', 'dark']) });
export type ThemeRequest = z.infer<typeof ThemeRequestSchema>;

export const SessionReportSchema = z.strictObject({ state: z.enum(['locked', 'unlocked']) });
export type SessionReport = z.infer<typeof SessionReportSchema>;

export const BadgeRequestSchema = z.strictObject({ count: z.number().int().min(0).max(999) });
export type BadgeRequest = z.infer<typeof BadgeRequestSchema>;

export const RecentFoldsRequestSchema = z.strictObject({
  folds: z.array(z.strictObject({ id: z.string().min(1).max(64), name: z.string().max(40) })).max(5),
});
export type RecentFoldsRequest = z.infer<typeof RecentFoldsRequestSchema>;

export const PopupMenuRequestSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z][a-z-]{0,23}$/),
        label: z.string().min(1).max(60),
        destructive: z.boolean().optional(),
        disabled: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(12),
});
export type PopupMenuRequest = z.infer<typeof PopupMenuRequestSchema>;
export const PopupMenuResponseSchema = z.strictObject({ id: z.string().nullable() });
export type PopupMenuResponse = z.infer<typeof PopupMenuResponseSchema>;

/** The closed set of things a menu, shortcut, tray or quick action can ask the page to do. No action carries data. */
export const ACTION_IDS = [
  'new-transaction',
  'lock',
  'settings',
  'search',
  'go:overview',
  'go:transactions',
  'go:accounts',
  'go:plan',
  'go:settings',
  'import',
  'export',
  'show',
  'quit',
  'open-fold:0',
  'open-fold:1',
  'open-fold:2',
  'open-fold:3',
  'open-fold:4',
] as const;
export const ActionIdSchema = z.enum(ACTION_IDS);
export type ActionId = z.infer<typeof ActionIdSchema>;
export const MenuActionEventSchema = z.strictObject({ action: ActionIdSchema });

export const SystemLockEventSchema = z.strictObject({ reason: z.enum(LOCK_REASONS) });
export type SystemLockEvent = z.infer<typeof SystemLockEventSchema>;

export const INCOMING_LIMITS = { csvBytes: 16 * 1024 * 1024, backupBytes: 128 * 1024 * 1024, nameChars: 120 } as const;
const fileName = z.string().min(1).max(INCOMING_LIMITS.nameChars);
export const IncomingItemSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('csv'), name: fileName, bytes: z.instanceof(Uint8Array) }),
  z.strictObject({ kind: z.literal('backup'), name: fileName, bytes: z.instanceof(Uint8Array) }),
  z.strictObject({
    kind: z.literal('link'),
    name: fileName,
    link: z.union([
      z.strictObject({ screen: z.literal('add-device'), email: z.string().max(254).optional(), server: z.string().max(300).optional() }),
      z.strictObject({ screen: z.literal('open'), target: z.enum(['overview', 'transactions', 'accounts', 'plan', 'settings']) }),
    ]),
  }),
  // A refused item is reported so the person sees why; it carries a reason code and nothing from the item itself.
  z.strictObject({ kind: z.literal('refused'), reason: z.string().regex(/^[a-z][a-z-]{0,31}$/) }),
]);
export type IncomingItem = z.infer<typeof IncomingItemSchema>;

export const FrameStateSchema = z.strictObject({ fullscreen: z.boolean(), maximized: z.boolean(), translucent: z.boolean() });
export type FrameState = z.infer<typeof FrameStateSchema>;

/** Calls that take no argument. */
export const NoRequestSchema = z.undefined();
export const VoidResponseSchema = z.undefined();
