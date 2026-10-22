import { z } from 'zod';

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

/** Calls that take no argument. */
export const NoRequestSchema = z.undefined();
export const VoidResponseSchema = z.undefined();
