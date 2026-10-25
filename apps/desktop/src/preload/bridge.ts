import {
  AboutInfoSchema,
  AutoCheckResponseSchema,
  BRIDGE_GLOBAL,
  CHANNELS,
  LanguageRequestSchema,
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

export function createBridge(ipc: IpcRendererLike): DesktopBridge {
  const call = async <S extends z.ZodType>(channel: string, schema: S, request?: unknown): Promise<z.infer<S>> =>
    schema.parse(await ipc.invoke(channel, ...(request === undefined ? [] : [request]))) as z.infer<S>;

  return {
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
export function installBridge(contextBridge: ContextBridgeLike, ipc: IpcRendererLike): void {
  const bridge = createBridge(ipc);
  contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, Object.freeze({ ...bridge, updates: Object.freeze({ ...bridge.updates }) }));
}
