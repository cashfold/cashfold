// IPC channel names between the web app (through the preload bridge) and the desktop main process. One place, so both sides agree.
export const CHANNELS = {
  about: 'cashfold:about',
  revealDataFolder: 'cashfold:data:reveal',
  updateState: 'cashfold:update:state',
  updateCheck: 'cashfold:update:check',
  updateDownload: 'cashfold:update:download',
  updateInstall: 'cashfold:update:install',
  updateReleasePage: 'cashfold:update:release-page',
  updateAutoCheck: 'cashfold:update:auto-check',
  /** The language the app is shown in, so the shell's own menus and dialogs follow it. */
  setLanguage: 'cashfold:language',
  /** Desktop preferences and what this computer can do (specs/006). */
  settings: 'cashfold:settings',
  settingsSet: 'cashfold:settings:set',
  /** The page's theme choice, so the shell's first frame and native chrome match. */
  theme: 'cashfold:theme',
  /** Whether the page is locked or unlocked; a presentation hint only. */
  session: 'cashfold:session',
  badge: 'cashfold:badge',
  recentFolds: 'cashfold:recent-folds',
  popupMenu: 'cashfold:popup-menu',
  windowShow: 'cashfold:window:show',
  /** The page has a listener for `incoming`; sent by the preload when one is registered, so nothing is delivered to a page that cannot take it yet. */
  incomingReady: 'cashfold:incoming-ready',
  /** main → renderer events */
  updateChanged: 'cashfold:update:changed',
  systemLock: 'cashfold:system-lock',
  menuAction: 'cashfold:menu-action',
  incoming: 'cashfold:incoming',
  frameState: 'cashfold:frame-state',
  settingsChanged: 'cashfold:settings:changed',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

/** The name of the single global the preload script exposes to the page. */
export const BRIDGE_GLOBAL = 'cashfoldDesktop';
