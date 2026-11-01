import type {
  AboutInfo,
  ActionId,
  DesktopSettings,
  Capabilities,
  FrameState,
  IncomingItem,
  PopupMenuRequest,
  RecentFoldsRequest,
  SettingsSetResponse,
  SettingsUpdate,
  ShellLanguage,
  SystemLockEvent,
  ThemeRequest,
  UpdateState,
} from './schemas';

/** What the desktop shell offers the web app. Absent in the plain web build. */
export interface DesktopBridge {
  about(): Promise<AboutInfo>;
  revealDataFolder(): Promise<void>;
  /** Tells the shell which language the app is shown in, so its menus follow. Only languages the shell knows are accepted. */
  setLanguage(language: ShellLanguage): Promise<void>;
  /** Which operating system the shell runs on; read once, so the page can set its frame before first paint. */
  readonly platform: 'win32' | 'darwin' | 'linux';
  readonly settings: {
    /** The stored preferences and what this computer can do. */
    get(): Promise<{ settings: DesktopSettings; capabilities: Capabilities }>;
    set(change: SettingsUpdate): Promise<SettingsSetResponse>;
  };
  /** Mirrors the page's theme choice so the first frame and the native chrome match. */
  setTheme(theme: ThemeRequest['theme']): Promise<void>;
  /** A presentation hint: the shell holds nothing sensitive whatever it is told. */
  reportSession(state: 'locked' | 'unlocked'): Promise<void>;
  setBadge(count: number): Promise<void>;
  setRecentFolds(folds: RecentFoldsRequest['folds']): Promise<void>;
  /** A native pop-up menu at the pointer; resolves with the chosen id, or null. */
  popupMenu(items: PopupMenuRequest['items']): Promise<string | null>;
  /** Shows, restores and focuses the window. */
  showWindow(): Promise<void>;
  onSystemLock(listener: (event: SystemLockEvent) => void): () => void;
  onMenuAction(listener: (action: ActionId) => void): () => void;
  onIncoming(listener: (item: IncomingItem) => void): () => void;
  onFrameState(listener: (state: FrameState) => void): () => void;
  onSettingsChanged(listener: (settings: DesktopSettings) => void): () => void;
  readonly updates: {
    state(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    /** Only valid in `available` with mode `in-app`. */
    download(): Promise<UpdateState>;
    /** Only valid in `ready`; quits and relaunches. */
    install(): Promise<void>;
    /** `manual` mode, and the "what's new" link. */
    openReleasePage(): Promise<void>;
    /** Periodic checks on or off (default on). */
    autoCheck(): Promise<boolean>;
    setAutoCheck(on: boolean): Promise<void>;
    onChange(listener: (state: UpdateState) => void): () => void;
  };
}
