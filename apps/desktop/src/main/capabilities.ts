import type { Capabilities } from '@cashfold/platform';

// What this computer can do, worked out from facts handed in (so it can be tested for every system without being on it). It is read-only and
// per run; Settings → Desktop shows it so that nothing is promised that the system will not deliver (spec 006, FR-005 and FR-023).

export interface CapabilityFacts {
  readonly platform: NodeJS.Platform;
  /** `XDG_CURRENT_DESKTOP`, a colon-separated list on Linux. */
  readonly desktop: string | undefined;
  /** The Windows build number from `os.release()`, when on Windows. */
  readonly windowsBuild: number | undefined;
  readonly reducedTransparency: boolean;
  readonly highContrast: boolean;
  readonly notifications: Capabilities['notifications'];
}

/** Linux desktops known to show a tray icon without extra software. Plain GNOME does not, so it is left out. */
const STATUS_ITEM_DESKTOPS = ['KDE', 'XFCE', 'X-CINNAMON', 'CINNAMON', 'MATE', 'LXQT', 'BUDGIE', 'PANTHEON', 'DEEPIN'];
/** Windows 11 22H2, the first build with the Mica backdrop the window can request. */
const MICA_BUILD = 22621;

export function windowsBuildFrom(release: string): number | undefined {
  const build = Number(release.split('.')[2]);
  return Number.isInteger(build) ? build : undefined;
}

export function hasStatusItem(platform: NodeJS.Platform, desktop: string | undefined): boolean {
  if (platform === 'win32' || platform === 'darwin') return true;
  if (platform !== 'linux' || desktop === undefined) return false;
  return desktop
    .toUpperCase()
    .split(':')
    .some((name) => STATUS_ITEM_DESKTOPS.includes(name.trim()));
}

export function describeCapabilities(facts: CapabilityFacts): Capabilities {
  const { platform } = facts;
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') throw new Error('unsupported platform');
  const translucent = platform === 'darwin' || (platform === 'win32' && (facts.windowsBuild ?? 0) >= MICA_BUILD);
  return {
    platform,
    // Windows and macOS report the screen locking and sleep; Linux reports sleep through logind, and the screen locking only on desktops that
    // announce it, so the idle check (polled) is what can be relied on there.
    lockEvents: platform === 'linux' ? ['suspend', 'idle-state'] : ['screen-lock', 'suspend', 'idle-state'],
    badge: platform === 'win32' || platform === 'darwin',
    statusItem: hasStatusItem(platform, facts.desktop),
    jumpList: platform === 'win32',
    dockMenu: platform === 'darwin',
    notifications: facts.notifications,
    translucency: !translucent ? 'unavailable' : facts.reducedTransparency || facts.highContrast ? 'reduced' : 'active',
    loginItem: true,
  };
}
