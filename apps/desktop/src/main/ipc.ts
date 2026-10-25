import {
  AboutInfoSchema,
  AutoCheckRequestSchema,
  AutoCheckResponseSchema,
  CHANNELS,
  LanguageRequestSchema,
  UpdateStateSchema,
  VoidResponseSchema,
  type AboutInfo,
  type ShellLanguage,
  type UpdateState,
} from '@cashfold/platform';
import type { z } from 'zod';
import type { Logger } from './log';

// The page's only way into the shell. Each channel does exactly one thing; the caller must be the app's own page; arguments are checked
// against strict schemas (an unexpected one is a refusal), and so is the answer on its way back. A failure tells the page nothing about the
// machine: the details go to the log, without their content (specs/003/contracts/desktop-bridge.md, validation rules).

export interface IpcEventLike {
  readonly senderFrame?: { readonly url: string } | null;
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void;
}

/** What the shell can do for the page in this build. Update handlers join in with the updater. */
export interface IpcHandlers {
  about(): AboutInfo;
  revealDataFolder(): Promise<void>;
  /** The app changed its language: rebuild the menus in it. */
  setLanguage(language: ShellLanguage): void;
  updateState(): UpdateState;
  updateCheck(): Promise<UpdateState>;
  /** Only valid in `available` (in-app); rejects otherwise. */
  updateDownload(): Promise<UpdateState>;
  /** Only valid in `ready`; rejects otherwise. Quits the app. */
  updateInstall(): Promise<void>;
  openReleasePage(): Promise<void>;
  /** Reads the automatic update check setting, or stores it when given a value; returns the setting. */
  autoCheck(set?: boolean): boolean;
}

const APP_PAGE = /^app:\/\/cashfold(?:[/?#]|$)/;

/** True only for a frame of the app's own origin (or, in an unpackaged run, of the development server named by the caller). */
export function isAppSender(event: IpcEventLike, extraOrigins: readonly string[] = []): boolean {
  const url = event.senderFrame?.url;
  if (typeof url !== 'string') return false;
  if (APP_PAGE.test(url)) return true;
  try {
    return extraOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

class Refused extends Error {
  constructor() {
    super('refused');
  }
}

export interface RegisterIpcOptions {
  readonly ipcMain: IpcMainLike;
  readonly log: Pick<Logger, 'ipc'>;
  readonly handlers: IpcHandlers;
  /** Origins other than the app's that may call: the development server, in an unpackaged run only. */
  readonly extraOrigins?: readonly string[];
}

export function registerIpc({ ipcMain, log, handlers, extraOrigins = [] }: RegisterIpcOptions): void {
  /** One channel: check the caller, parse the arguments, run, check the answer. */
  function serve<Args, Result extends z.ZodType>(
    channel: string,
    parseArgs: (args: readonly unknown[]) => Args | undefined,
    answer: Result,
    run: (args: Args) => unknown,
  ): void {
    ipcMain.handle(channel, async (event, ...raw) => {
      let args: Args | undefined;
      if (!isAppSender(event, extraOrigins) || (args = parseArgs(raw)) === undefined) {
        log.ipc(channel, 'rejected');
        throw new Refused();
      }
      try {
        const result = answer.parse(await run(args)) as z.infer<Result>;
        log.ipc(channel, 'ok');
        return result;
      } catch {
        log.ipc(channel, 'error');
        throw new Error('failed');
      }
    });
  }

  const none = (args: readonly unknown[]): [] | undefined => (args.length === 0 ? [] : undefined);

  serve(CHANNELS.about, none, AboutInfoSchema, () => handlers.about());
  serve(CHANNELS.revealDataFolder, none, VoidResponseSchema, () => handlers.revealDataFolder());
  serve(
    CHANNELS.setLanguage,
    (args) => {
      if (args.length !== 1) return undefined;
      const parsed = LanguageRequestSchema.safeParse(args[0]);
      return parsed.success ? parsed.data : undefined;
    },
    VoidResponseSchema,
    (request) => handlers.setLanguage(request.language),
  );
  serve(CHANNELS.updateState, none, UpdateStateSchema, () => handlers.updateState());
  serve(CHANNELS.updateCheck, none, UpdateStateSchema, () => handlers.updateCheck());
  serve(CHANNELS.updateDownload, none, UpdateStateSchema, () => handlers.updateDownload());
  serve(CHANNELS.updateInstall, none, VoidResponseSchema, () => handlers.updateInstall());
  serve(CHANNELS.updateReleasePage, none, VoidResponseSchema, () => handlers.openReleasePage());
  serve(
    CHANNELS.updateAutoCheck,
    (args) => {
      if (args.length !== 1) return undefined;
      const parsed = AutoCheckRequestSchema.safeParse(args[0]);
      return parsed.success ? parsed.data : undefined;
    },
    AutoCheckResponseSchema,
    (request) => handlers.autoCheck(request.set),
  );
}
