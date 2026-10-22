import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AboutInfoSchema, AutoCheckRequestSchema, UpdateStateSchema } from './schemas';

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
