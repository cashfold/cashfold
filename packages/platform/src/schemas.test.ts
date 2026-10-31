import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ActionIdSchema,
  AboutInfoSchema,
  AutoCheckRequestSchema,
  BadgeRequestSchema,
  CapabilitiesSchema,
  DesktopSettingsSchema,
  FrameStateSchema,
  IncomingItemSchema,
  PopupMenuRequestSchema,
  PopupMenuResponseSchema,
  RecentFoldsRequestSchema,
  SessionReportSchema,
  SettingsUpdateSchema,
  SystemLockEventSchema,
  ThemeRequestSchema,
  UpdateStateSchema,
} from './schemas';

const about = {
  version: '1.2.3',
  buildId: '0123456789abcdef0123456789abcdef01234567',
  electron: '45.0.0',
  chromium: '140.0.0.0',
  os: 'linux',
  arch: 'x64',
  packaging: 'appimage',
  updateMode: 'in-app',
  signed: false,
  dataPath: '/home/someone/.config/Cashfold',
  sourceUrl: 'https://github.com/cashfold/cashfold/tree/v1.2.3',
} as const;

const without = <T extends object>(value: T, key: string): Record<string, unknown> => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));

const states = [
  { kind: 'idle' },
  { kind: 'checking' },
  { kind: 'none' },
  { kind: 'available', version: '1.3.0', notesUrl: 'https://github.com/cashfold/cashfold/releases/tag/v1.3.0', mode: 'in-app' },
  { kind: 'downloading', version: '1.3.0', percent: 42 },
  { kind: 'ready', version: '1.3.0' },
  { kind: 'error', code: 'offline' },
] as const;

describe('AboutInfo', () => {
  it('accepts a complete description of the running app', () => {
    expect(AboutInfoSchema.safeParse(about).success).toBe(true);
  });

  it('requires every field', () => {
    for (const key of Object.keys(about)) {
      expect(AboutInfoSchema.safeParse(without(about, key)).success, `without ${key}`).toBe(false);
    }
  });

  it('allows only the three operating systems, two architectures, six packagings and two update modes', () => {
    for (const os of ['win32', 'darwin', 'linux']) expect(AboutInfoSchema.safeParse({ ...about, os }).success).toBe(true);
    for (const arch of ['x64', 'arm64']) expect(AboutInfoSchema.safeParse({ ...about, arch }).success).toBe(true);
    for (const packaging of ['nsis', 'dmg', 'appimage', 'deb', 'rpm', 'unpacked']) expect(AboutInfoSchema.safeParse({ ...about, packaging }).success).toBe(true);
    for (const updateMode of ['in-app', 'manual']) expect(AboutInfoSchema.safeParse({ ...about, updateMode }).success).toBe(true);
    expect(AboutInfoSchema.safeParse({ ...about, os: 'freebsd' }).success).toBe(false);
    expect(AboutInfoSchema.safeParse({ ...about, arch: 'ia32' }).success).toBe(false);
    expect(AboutInfoSchema.safeParse({ ...about, packaging: 'snap' }).success).toBe(false);
    expect(AboutInfoSchema.safeParse({ ...about, updateMode: 'auto' }).success).toBe(false);
  });

  it('requires an https source URL', () => {
    expect(AboutInfoSchema.safeParse({ ...about, sourceUrl: 'http://github.com/cashfold/cashfold' }).success).toBe(false);
    expect(AboutInfoSchema.safeParse({ ...about, sourceUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(AboutInfoSchema.safeParse({ ...about, sourceUrl: 'not a url' }).success).toBe(false);
  });

  it('requires signed to be a boolean', () => {
    expect(AboutInfoSchema.safeParse({ ...about, signed: 'yes' }).success).toBe(false);
  });
});

describe('UpdateState', () => {
  it('accepts each of the seven states', () => {
    for (const state of states) expect(UpdateStateSchema.safeParse(state).success, state.kind).toBe(true);
  });

  it('knows exactly the seven kinds', () => {
    expect(UpdateStateSchema.safeParse({ kind: 'installing' }).success).toBe(false);
    expect(UpdateStateSchema.safeParse({ kind: 'IDLE' }).success).toBe(false);
    expect(UpdateStateSchema.safeParse({}).success).toBe(false);
  });

  it('carries a version, an https notes URL and a mode when an update is available', () => {
    const available = states[3];
    expect(UpdateStateSchema.safeParse({ ...available, notesUrl: 'http://example.com' }).success).toBe(false);
    expect(UpdateStateSchema.safeParse({ ...available, mode: 'silent' }).success).toBe(false);
    for (const key of ['version', 'notesUrl', 'mode']) {
      expect(UpdateStateSchema.safeParse(without(available, key)).success, `without ${key}`).toBe(false);
    }
  });

  it('keeps the download percentage an integer from 0 to 100', () => {
    const base = { kind: 'downloading', version: '1.3.0' };
    for (const percent of [0, 1, 99, 100]) expect(UpdateStateSchema.safeParse({ ...base, percent }).success, String(percent)).toBe(true);
    for (const percent of [-1, 101, 12.5, Number.NaN, Number.POSITIVE_INFINITY, '50']) expect(UpdateStateSchema.safeParse({ ...base, percent }).success, String(percent)).toBe(false);
  });

  it('uses exactly four error codes', () => {
    for (const code of ['offline', 'verify-failed', 'download-failed', 'unknown']) expect(UpdateStateSchema.safeParse({ kind: 'error', code }).success).toBe(true);
    expect(UpdateStateSchema.safeParse({ kind: 'error', code: 'timeout' }).success).toBe(false);
    expect(UpdateStateSchema.safeParse({ kind: 'error' }).success).toBe(false);
  });
});

describe('auto-check request', () => {
  it('accepts no argument, or a boolean set', () => {
    expect(AutoCheckRequestSchema.safeParse({}).success).toBe(true);
    expect(AutoCheckRequestSchema.safeParse({ set: true }).success).toBe(true);
    expect(AutoCheckRequestSchema.safeParse({ set: false }).success).toBe(true);
  });

  it('rejects a non-boolean set', () => {
    for (const set of ['true', 1, 0, null, {}]) expect(AutoCheckRequestSchema.safeParse({ set }).success, String(set)).toBe(false);
  });
});

describe('strict objects', () => {
  const cases: Array<[string, { safeParse(v: unknown): { success: boolean } }, object]> = [
    ['AboutInfo', AboutInfoSchema, about],
    ...states.map((s): [string, typeof UpdateStateSchema, object] => [`UpdateState ${s.kind}`, UpdateStateSchema, s]),
    ['auto-check request', AutoCheckRequestSchema, { set: true }],
  ];

  for (const [name, schema, sample] of cases) {
    it(`${name} rejects any extra key`, () => {
      expect(schema.safeParse(sample).success).toBe(true);
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((k) => !(k in sample) && k !== '__proto__'),
          fc.anything(),
          (key, value) => !schema.safeParse({ ...sample, [key]: value }).success,
        ),
      );
    });
  }
});

describe('desktop experience schemas (spec 006)', () => {
  const capabilities = {
    platform: 'linux',
    lockEvents: ['screen-lock', 'suspend'],
    badge: false,
    statusItem: true,
    jumpList: false,
    dockMenu: false,
    notifications: 'granted',
    translucency: 'unavailable',
    loginItem: true,
  } as const;
  const settings = { hideOnBlur: false, startAtLogin: false, closeBehavior: 'quit', theme: 'system' } as const;
  const folds = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `fold-${index}`, name: `Fold ${index}` }));
  const menu = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `item-${String.fromCharCode(97 + index)}`, label: `Item ${index}` }));

  // [name, schema, a valid value]
  const valid = [
    ['settings', DesktopSettingsSchema, settings],
    ['capabilities', CapabilitiesSchema, capabilities],
    ['settings update', SettingsUpdateSchema, { hideOnBlur: true }],
    ['theme', ThemeRequestSchema, { theme: 'dark' }],
    ['session', SessionReportSchema, { state: 'locked' }],
    ['badge', BadgeRequestSchema, { count: 999 }],
    ['recent folds', RecentFoldsRequestSchema, { folds: folds(5) }],
    ['popup menu request', PopupMenuRequestSchema, { items: [{ id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete', destructive: true }] }],
    ['popup menu response', PopupMenuResponseSchema, { id: null }],
    ['system lock', SystemLockEventSchema, { reason: 'suspend' }],
    ['frame state', FrameStateSchema, { fullscreen: false, maximized: true, translucent: false }],
    ['incoming link', IncomingItemSchema, { kind: 'link', name: 'link', link: { screen: 'open', target: 'plan' } }],
  ] as const;

  it.each(valid)('accepts a valid %s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it.each(valid)('refuses an unknown key in a %s', (_name, schema, value) => {
    expect(schema.safeParse({ ...value, extra: 1 }).success).toBe(false);
  });

  it('refuses wrong types', () => {
    expect(DesktopSettingsSchema.safeParse({ ...settings, hideOnBlur: 'yes' }).success).toBe(false);
    expect(DesktopSettingsSchema.safeParse({ ...settings, closeBehavior: 'minimise' }).success).toBe(false);
    expect(ThemeRequestSchema.safeParse({ theme: 'sepia' }).success).toBe(false);
    expect(BadgeRequestSchema.safeParse({ count: 1.5 }).success).toBe(false);
    expect(BadgeRequestSchema.safeParse({ count: '3' }).success).toBe(false);
  });

  it('bounds the badge count', () => {
    expect(BadgeRequestSchema.safeParse({ count: 0 }).success).toBe(true);
    expect(BadgeRequestSchema.safeParse({ count: 1000 }).success).toBe(false);
    expect(BadgeRequestSchema.safeParse({ count: -1 }).success).toBe(false);
  });

  it('allows five recent Folds and refuses a sixth, or a long name', () => {
    expect(RecentFoldsRequestSchema.safeParse({ folds: folds(0) }).success).toBe(true);
    expect(RecentFoldsRequestSchema.safeParse({ folds: folds(6) }).success).toBe(false);
    expect(RecentFoldsRequestSchema.safeParse({ folds: [{ id: 'a', name: 'x'.repeat(41) }] }).success).toBe(false);
  });

  it('allows twelve menu items and refuses a thirteenth, an empty list, a capital letter and a long label', () => {
    expect(PopupMenuRequestSchema.safeParse({ items: menu(12) }).success).toBe(true);
    expect(PopupMenuRequestSchema.safeParse({ items: menu(13) }).success).toBe(false);
    expect(PopupMenuRequestSchema.safeParse({ items: [] }).success).toBe(false);
    expect(PopupMenuRequestSchema.safeParse({ items: [{ id: 'Edit', label: 'Edit' }] }).success).toBe(false);
    expect(PopupMenuRequestSchema.safeParse({ items: [{ id: 'edit', label: 'x'.repeat(61) }] }).success).toBe(false);
    expect(PopupMenuRequestSchema.safeParse({ items: [{ id: 'edit', label: 'x'.repeat(60) }] }).success).toBe(true);
  });

  it('needs at least one setting in an update', () => {
    expect(SettingsUpdateSchema.safeParse({}).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({ theme: 'dark' }).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({ startAtLogin: true, closeBehavior: 'background' }).success).toBe(true);
  });

  it('knows only the closed set of actions', () => {
    expect(ActionIdSchema.safeParse('new-transaction').success).toBe(true);
    expect(ActionIdSchema.safeParse('palette').success).toBe(true);
    expect(ActionIdSchema.safeParse('open-fold:4').success).toBe(true);
    expect(ActionIdSchema.safeParse('open-fold:5').success).toBe(false);
    expect(ActionIdSchema.safeParse('rm -rf').success).toBe(false);
  });

  it('checks incoming items', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(IncomingItemSchema.safeParse({ kind: 'csv', name: 'a.csv', bytes }).success).toBe(true);
    expect(IncomingItemSchema.safeParse({ kind: 'csv', name: 'a.csv', bytes: [1, 2] }).success).toBe(false);
    expect(IncomingItemSchema.safeParse({ kind: 'csv', name: 'x'.repeat(121), bytes }).success).toBe(false);
    expect(IncomingItemSchema.safeParse({ kind: 'link', name: 'l', link: { screen: 'open', target: 'secrets' } }).success).toBe(false);
    expect(IncomingItemSchema.safeParse({ kind: 'refused', reason: 'too-long' }).success).toBe(true);
  });
});

describe('the primary colour request', () => {
  it('takes a palette id and nothing else', async () => {
    const { PrimaryColorRequestSchema, PRIMARY_COLORS } = await import('./schemas');
    for (const id of PRIMARY_COLORS) expect(PrimaryColorRequestSchema.safeParse({ primary: id }).success).toBe(true);
    for (const bad of [{ primary: 'purple' }, { primary: '' }, { primary: '../x' }, { primary: 'blue', path: 'x' }, {}, null]) expect(PrimaryColorRequestSchema.safeParse(bad).success).toBe(false);
  });
});
