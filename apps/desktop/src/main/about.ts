import type { AboutInfo } from '@cashfold/platform';
import { SOURCE_REPO_URL } from './identity';
import { decideUpdateMode } from './update-mode';

// What Settings → About shows about the running app. Built from facts main knows; the page supplies nothing.

export interface AboutDeps {
  /** The release version: the packaged package.json, which is the version of the installer and of the tag. */
  readonly version: string;
  /** The commit the web export was built from; unknown when running from source. */
  readonly commit?: string;
  readonly electronVersion: string;
  readonly chromeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly isPackaged: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The running executable. */
  readonly execPath: string;
  readonly exists: (path: string) => boolean;
  /** Whether this build's installers were code-signed. */
  readonly signed: boolean;
  /** The data folder. */
  readonly userData: string;
}

/** How this copy of the app was installed, which decides how it can update (AppImage and the installers can; deb and rpm cannot). */
export function detectPackaging(deps: Pick<AboutDeps, 'isPackaged' | 'platform' | 'env' | 'execPath' | 'exists'>): AboutInfo['packaging'] {
  if (!deps.isPackaged) return 'unpacked';
  if (deps.platform === 'win32') return 'nsis';
  if (deps.platform === 'darwin') return 'dmg';
  if (deps.env['APPIMAGE'] !== undefined && deps.env['APPIMAGE'] !== '') return 'appimage';
  // The deb and rpm packages install under /opt; which one it was is told by the package manager that has a database on this system.
  if (deps.execPath.startsWith('/opt/')) {
    if (deps.exists('/var/lib/dpkg/status')) return 'deb';
    if (deps.exists('/var/lib/rpm') || deps.exists('/usr/lib/sysimage/rpm')) return 'rpm';
  }
  return 'unpacked';
}

export function buildAbout(deps: AboutDeps): AboutInfo {
  if (deps.platform !== 'win32' && deps.platform !== 'darwin' && deps.platform !== 'linux') throw new Error(`unsupported platform ${deps.platform}`);
  if (deps.arch !== 'x64' && deps.arch !== 'arm64') throw new Error(`unsupported architecture ${deps.arch}`);
  const packaging = detectPackaging(deps);
  return {
    version: deps.version,
    buildId: deps.commit ?? 'development',
    electron: deps.electronVersion,
    chromium: deps.chromeVersion,
    os: deps.platform,
    arch: deps.arch,
    packaging,
    updateMode: decideUpdateMode({ platform: deps.platform, packaging, signed: deps.signed }),
    signed: deps.signed,
    dataPath: deps.userData,
    sourceUrl: `${SOURCE_REPO_URL}/tree/v${deps.version}`,
  };
}
