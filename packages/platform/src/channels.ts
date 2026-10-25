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
  /** main → renderer event */
  updateChanged: 'cashfold:update:changed',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

/** The name of the single global the preload script exposes to the page. */
export const BRIDGE_GLOBAL = 'cashfoldDesktop';
