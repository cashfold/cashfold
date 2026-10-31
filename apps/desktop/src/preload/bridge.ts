import {
  AboutInfoSchema,
  AutoCheckResponseSchema,
  BRIDGE_GLOBAL,
  BadgeRequestSchema,
  CHANNELS,
  DesktopSettingsSchema,
  FrameStateSchema,
  IncomingItemSchema,
  LanguageRequestSchema,
  MenuActionEventSchema,
  PopupMenuRequestSchema,
  PopupMenuResponseSchema,
  RecentFoldsRequestSchema,
  SessionReportSchema,
  SettingsResponseSchema,
  SettingsSetResponseSchema,
  SettingsUpdateSchema,
  SystemLockEventSchema,
  PrimaryColorRequestSchema,
  ThemeRequestSchema,
  UpdateStateSchema,
  VoidResponseSchema,
  type DesktopBridge,
} from '@cashfold/platform';
import type { z } from 'zod';

// The only thing the page can reach in the shell. Each call is one fixed channel with no caller-supplied path, URL or command, and every
// answer is checked against the shared schema before the page sees it (specs/003/contracts/desktop-bridge.md).

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

export interface ContextBridgeLike {
  exposeInMainWorld(name: string, api: unknown): void;
}

const PLATFORMS = ['win32', 'darwin', 'linux'] as const;

export function createBridge(ipc: IpcRendererLike, platform: string = process.platform): DesktopBridge {
  const known = PLATFORMS.find((value) => value === platform);
  if (known === undefined) throw new Error('unsupported platform');
  const call = async <S extends z.ZodType>(channel: string, schema: S, request?: unknown): Promise<z.infer<S>> =>
    schema.parse(await ipc.invoke(channel, ...(request === undefined ? [] : [request]))) as z.infer<S>;

  /** An event from the shell: checked against its schema, and dropped if it does not match. */
  const listen = <S extends z.ZodType>(channel: string, schema: S, pick: (value: z.infer<S>) => unknown) => (listener: (value: never) => void): (() => void) => {
    const handler = (_event: unknown, payload: unknown): void => {
      const parsed = schema.safeParse(payload);
      if (parsed.success) listener(pick(parsed.data as z.infer<S>) as never);
    };
    ipc.on(channel, handler);
    return () => void ipc.removeListener(channel, handler);
  };
  const identity = (value: unknown): unknown => value;

  return {
    platform: known,
    settings: {
      get: () => call(CHANNELS.settings, SettingsResponseSchema),
      set: async (change) => call(CHANNELS.settingsSet, SettingsSetResponseSchema, SettingsUpdateSchema.parse(change)),
    },
    setTheme: async (theme) => {
      await call(CHANNELS.theme, VoidResponseSchema, ThemeRequestSchema.parse({ theme }));
    },
    setPrimaryColor: async (primary) => {
      await call(CHANNELS.primaryColor, VoidResponseSchema, PrimaryColorRequestSchema.parse({ primary }));
    },
    reportSession: async (state) => {
      await call(CHANNELS.session, VoidResponseSchema, SessionReportSchema.parse({ state }));
    },
    setBadge: async (count) => {
      await call(CHANNELS.badge, VoidResponseSchema, BadgeRequestSchema.parse({ count }));
    },
    setRecentFolds: async (folds) => {
      await call(CHANNELS.recentFolds, VoidResponseSchema, RecentFoldsRequestSchema.parse({ folds }));
    },
    popupMenu: async (items) => (await call(CHANNELS.popupMenu, PopupMenuResponseSchema, PopupMenuRequestSchema.parse({ items }))).id,
    showWindow: () => call(CHANNELS.windowShow, VoidResponseSchema),
    onSystemLock: listen(CHANNELS.systemLock, SystemLockEventSchema, identity),
    onMenuAction: listen(CHANNELS.menuAction, MenuActionEventSchema, (value) => value.action),
    onIncoming: (listener) => {
      const stop = listen(CHANNELS.incoming, IncomingItemSchema, identity)(listener);
      // Tell the shell there is now a listener: items from outside are only delivered to a page that can take them.
      void call(CHANNELS.incomingReady, VoidResponseSchema).catch(() => undefined);
      return stop;
    },
    onFrameState: listen(CHANNELS.frameState, FrameStateSchema, identity),
    onSettingsChanged: listen(CHANNELS.settingsChanged, DesktopSettingsSchema, identity),
    about: () => call(CHANNELS.about, AboutInfoSchema),
    revealDataFolder: () => call(CHANNELS.revealDataFolder, VoidResponseSchema),
    setLanguage: async (language) => {
      await call(CHANNELS.setLanguage, VoidResponseSchema, LanguageRequestSchema.parse({ language }));
    },
    updates: {
      state: () => call(CHANNELS.updateState, UpdateStateSchema),
      check: () => call(CHANNELS.updateCheck, UpdateStateSchema),
      download: () => call(CHANNELS.updateDownload, UpdateStateSchema),
      install: () => call(CHANNELS.updateInstall, VoidResponseSchema),
      openReleasePage: () => call(CHANNELS.updateReleasePage, VoidResponseSchema),
      autoCheck: () => call(CHANNELS.updateAutoCheck, AutoCheckResponseSchema, {}),
      setAutoCheck: async (on) => {
        await call(CHANNELS.updateAutoCheck, AutoCheckResponseSchema, { set: on });
      },
      onChange(listener) {
        const handler = (_event: unknown, state: unknown): void => {
          const parsed = UpdateStateSchema.safeParse(state);
          if (parsed.success) listener(parsed.data);
        };
        ipc.on(CHANNELS.updateChanged, handler);
        return () => void ipc.removeListener(CHANNELS.updateChanged, handler);
      },
    },
  };
}

/** Exposes exactly one frozen global to the page. */
export function installBridge(contextBridge: ContextBridgeLike, ipc: IpcRendererLike, platform: string = process.platform): void {
  const bridge = createBridge(ipc, platform);
  contextBridge.exposeInMainWorld(
    BRIDGE_GLOBAL,
    Object.freeze({ ...bridge, settings: Object.freeze({ ...bridge.settings }), updates: Object.freeze({ ...bridge.updates }) }),
  );
}
