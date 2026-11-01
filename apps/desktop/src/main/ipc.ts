import {
  AboutInfoSchema,
  AutoCheckRequestSchema,
  AutoCheckResponseSchema,
  BadgeRequestSchema,
  CHANNELS,
  LanguageRequestSchema,
  PopupMenuRequestSchema,
  PopupMenuResponseSchema,
  RecentFoldsRequestSchema,
  SessionReportSchema,
  SettingsResponseSchema,
  SettingsSetResponseSchema,
  SettingsUpdateSchema,
  ThemeRequestSchema,
  UpdateStateSchema,
  VoidResponseSchema,
  type AboutInfo,
  type PopupMenuRequest,
  type RecentFoldsRequest,
  type SettingsResponse,
  type SettingsSetResponse,
  type SettingsUpdate,
  type ShellLanguage,
  type ThemeRequest,
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
  /** The stored desktop preferences and what this computer can do. */
  settings(): SettingsResponse;
  /** Stores a change (refusing `background` where there is no status item) and applies what it can; answers with the result. */
  settingsSet(update: SettingsUpdate): Promise<SettingsSetResponse> | SettingsSetResponse;
  setTheme(theme: ThemeRequest['theme']): void;
  /** The page's primary colour: the dock and window icon follow it. */
  /** The page locked or unlocked: surfaces that show app data clear on `locked`, queued items are delivered on `unlocked`. */
  reportSession(state: 'locked' | 'unlocked'): void;
  setBadge(count: number): void;
  setRecentFolds(folds: RecentFoldsRequest['folds']): void;
  popupMenu(items: PopupMenuRequest['items']): Promise<string | null>;
  showWindow(): void;
  /** The page can now take items from outside; they are delivered from here on (until the page loads again). */
  incomingReady(): void;
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

  /** One required argument, checked against a schema. */
  const one =
    <T>(schema: z.ZodType<T>) =>
    (args: readonly unknown[]): T | undefined => {
      if (args.length !== 1) return undefined;
      const parsed = schema.safeParse(args[0]);
      return parsed.success ? parsed.data : undefined;
    };
  // The last state the page reported. Nothing is decided on it that matters for secrecy (the shell holds none); it only keeps the shell's own
  // surfaces, such as the recent Folds list, from showing names while the page is locked or has not said.
  let session: 'locked' | 'unlocked' = 'locked';

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
  serve(CHANNELS.settings, none, SettingsResponseSchema, () => handlers.settings());
  serve(CHANNELS.settingsSet, one(SettingsUpdateSchema), SettingsSetResponseSchema, (update) => handlers.settingsSet(update));
  serve(CHANNELS.theme, one(ThemeRequestSchema), VoidResponseSchema, (request) => handlers.setTheme(request.theme));
  serve(CHANNELS.session, one(SessionReportSchema), VoidResponseSchema, (report) => {
    session = report.state;
    handlers.reportSession(report.state);
  });
  serve(CHANNELS.badge, one(BadgeRequestSchema), VoidResponseSchema, (request) => handlers.setBadge(session === 'unlocked' ? request.count : 0));
  serve(CHANNELS.recentFolds, one(RecentFoldsRequestSchema), VoidResponseSchema, (request) => {
    if (session !== 'unlocked') {
      handlers.setRecentFolds([]);
      throw new Error('locked');
    }
    handlers.setRecentFolds(request.folds);
  });
  serve(CHANNELS.popupMenu, one(PopupMenuRequestSchema), PopupMenuResponseSchema, async (request) => ({ id: await handlers.popupMenu(request.items) }));
  serve(CHANNELS.windowShow, none, VoidResponseSchema, () => handlers.showWindow());
  serve(CHANNELS.incomingReady, none, VoidResponseSchema, () => handlers.incomingReady());
}
