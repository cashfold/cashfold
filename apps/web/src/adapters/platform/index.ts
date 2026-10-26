import {
  AboutInfoSchema,
  ActionIdSchema,
  AutoCheckResponseSchema,
  DesktopSettingsSchema,
  FrameStateSchema,
  IncomingItemSchema,
  SettingsResponseSchema,
  SettingsSetResponseSchema,
  SystemLockEventSchema,
  UpdateStateSchema,
  type DesktopBridge,
  type UpdateState,
} from '@cashfold/platform';
import type { z } from 'zod';
import { findRawBridge } from './detect';

// The desktop app's window exposes one global, `cashfoldDesktop` (apps/desktop, specs/003 contract). In the plain web app it does not exist and
// nothing here does anything. When it does exist, whatever it says is checked again against the shared schemas before the interface sees it:
// the page treats the shell as a collaborator to be verified, not as trusted code.

const ERROR_STATE: UpdateState = { kind: 'error', code: 'unknown' };
/** One checked wrapper per bridge object, so the page keeps seeing the same instance. */
const wrapped = new WeakMap<object, DesktopBridge>();

/** The desktop bridge, or undefined in the web app. */
export function getDesktopBridge(host: object = globalThis): DesktopBridge | undefined {
  const raw = findRawBridge(host) as DesktopBridge | undefined;
  if (raw === undefined) return undefined;
  const known = wrapped.get(raw);
  if (known !== undefined) return known;
  const bridge = harden(raw);
  wrapped.set(raw, bridge);
  return bridge;
}

async function asState(call: () => Promise<unknown>): Promise<UpdateState> {
  try {
    const parsed = UpdateStateSchema.safeParse(await call());
    return parsed.success ? parsed.data : ERROR_STATE;
  } catch {
    return ERROR_STATE;
  }
}

/** An event from the shell, checked again here: a payload that does not fit its schema never reaches the listener. */
function checked<S extends z.ZodType>(subscribe: (listener: (value: never) => void) => () => void, schema: S) {
  return (listener: (value: z.infer<S>) => void): (() => void) =>
    subscribe(((value: unknown) => {
      const parsed = schema.safeParse(value);
      if (parsed.success) listener(parsed.data as z.infer<S>);
    }) as (value: never) => void);
}

/** A call that returns nothing, whose failure the page can do nothing about: a shell that fails or is missing the call is not an error to show. */
async function quietly(call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
  } catch {
    // The shell's own surfaces (badge, menus) are best effort; the page works without them.
  }
}

function harden(bridge: DesktopBridge): DesktopBridge {
  const { updates, settings } = bridge;
  return {
    platform: bridge.platform,
    settings: {
      get: async () => SettingsResponseSchema.parse(await settings.get()),
      set: async (change) => SettingsSetResponseSchema.parse(await settings.set(change)),
    },
    setTheme: (theme) => quietly(() => bridge.setTheme(theme)),
    reportSession: (state) => quietly(() => bridge.reportSession(state)),
    setBadge: (count) => quietly(() => bridge.setBadge(count)),
    setRecentFolds: (folds) => quietly(() => bridge.setRecentFolds(folds)),
    popupMenu: async (items) => {
      try {
        const id = await bridge.popupMenu(items);
        // Only an id the page offered can come back.
        return typeof id === 'string' && items.some((item) => item.id === id) ? id : null;
      } catch {
        return null;
      }
    },
    showWindow: () => quietly(() => bridge.showWindow()),
    onSystemLock: checked(bridge.onSystemLock as (listener: (value: never) => void) => () => void, SystemLockEventSchema),
    onMenuAction: (listener) => bridge.onMenuAction((action) => {
      const parsed = ActionIdSchema.safeParse(action);
      if (parsed.success) listener(parsed.data);
    }),
    onIncoming: checked(bridge.onIncoming as (listener: (value: never) => void) => () => void, IncomingItemSchema),
    onFrameState: checked(bridge.onFrameState as (listener: (value: never) => void) => () => void, FrameStateSchema),
    onSettingsChanged: checked(bridge.onSettingsChanged as (listener: (value: never) => void) => () => void, DesktopSettingsSchema),
    about: async () => AboutInfoSchema.parse(await bridge.about()),
    revealDataFolder: () => bridge.revealDataFolder(),
    setLanguage: (language) => bridge.setLanguage(language),
    updates: {
      state: () => asState(() => updates.state()),
      check: () => asState(() => updates.check()),
      download: () => asState(() => updates.download()),
      install: () => updates.install(),
      openReleasePage: () => updates.openReleasePage(),
      autoCheck: async () => {
        const parsed = AutoCheckResponseSchema.safeParse(await updates.autoCheck());
        return parsed.success ? parsed.data : true;
      },
      setAutoCheck: (on) => updates.setAutoCheck(on),
      onChange(listener) {
        return updates.onChange((state) => {
          const parsed = UpdateStateSchema.safeParse(state);
          if (parsed.success) listener(parsed.data);
        });
      },
    },
  };
}
