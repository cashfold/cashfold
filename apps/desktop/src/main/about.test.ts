import { AboutInfoSchema } from '@cashfold/platform';
import { describe, expect, it } from 'vitest';
import { buildAbout, detectPackaging, type AboutDeps } from './about';

const base: AboutDeps = {
  version: '1.2.3',
  commit: '0123456789abcdef0123456789abcdef01234567',
  electronVersion: '45.0.0',
  chromeVersion: '140.0.7339.0',
  platform: 'linux',
  arch: 'x64',
  isPackaged: true,
  env: {},
  execPath: '/opt/Cashfold/cashfold',
  exists: () => false,
  signed: false,
  userData: '/home/someone/.config/Cashfold',
};

describe('what the About view says', () => {
  it('describes the running app in the shape of the contract', () => {
    expect(AboutInfoSchema.safeParse(buildAbout(base)).success).toBe(true);
  });

  it('reports the version it was given, so About, the installer and the tag agree', () => {
    expect(buildAbout({ ...base, version: '7.8.9' }).version).toBe('7.8.9');
  });

  it('points to the source of exactly that version', () => {
    expect(buildAbout({ ...base, version: '1.2.3' }).sourceUrl).toBe('https://github.com/cashfold/cashfold/tree/v1.2.3');
  });

  it('shows the data folder main chose, the engine versions and the system', () => {
    const info = buildAbout({ ...base, platform: 'darwin', arch: 'arm64', userData: '/Users/x/Library/Application Support/Cashfold' });
    expect(info).toMatchObject({ os: 'darwin', arch: 'arm64', electron: '45.0.0', chromium: '140.0.7339.0', dataPath: '/Users/x/Library/Application Support/Cashfold', signed: false });
  });

  it('says development when it does not know the commit', () => {
    const withoutCommit: AboutDeps = Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'commit')) as unknown as AboutDeps;
    expect(buildAbout(withoutCommit).buildId).toBe('development');
    expect(buildAbout(base).buildId).toBe(base.commit);
  });

  it('says whether the build was signed', () => {
    expect(buildAbout({ ...base, signed: true }).signed).toBe(true);
  });

  it('says whether this copy can update itself, by how it was installed', () => {
    expect(buildAbout({ ...base, platform: 'linux', env: { APPIMAGE: '/x.AppImage' } }).updateMode).toBe('in-app');
    expect(buildAbout({ ...base, platform: 'win32' }).updateMode).toBe('in-app');
    expect(buildAbout({ ...base, platform: 'darwin', signed: false }).updateMode).toBe('manual');
    expect(buildAbout({ ...base, platform: 'darwin', signed: true }).updateMode).toBe('in-app');
    expect(buildAbout({ ...base, exists: (p) => p === '/var/lib/dpkg/status' }).updateMode).toBe('manual');
  });

  it('refuses a system it was not built for', () => {
    expect(() => buildAbout({ ...base, platform: 'freebsd' })).toThrow(/platform/);
    expect(() => buildAbout({ ...base, arch: 'ia32' })).toThrow(/architecture/);
  });
});

describe('how the app was installed', () => {
  const exists = (...present: string[]) => (path: string) => present.includes(path);

  it('is "unpacked" when it runs from source or an unpacked folder', () => {
    expect(detectPackaging({ ...base, isPackaged: false })).toBe('unpacked');
  });

  it('is the installer for the system on Windows and macOS', () => {
    expect(detectPackaging({ ...base, platform: 'win32', execPath: 'C:\\Users\\x\\AppData\\Local\\Programs\\Cashfold\\Cashfold.exe' })).toBe('nsis');
    expect(detectPackaging({ ...base, platform: 'darwin', execPath: '/Applications/Cashfold.app/Contents/MacOS/Cashfold' })).toBe('dmg');
  });

  it('is an AppImage when the AppImage launcher says so', () => {
    expect(detectPackaging({ ...base, env: { APPIMAGE: '/home/x/Cashfold-1.2.3-linux-x64.AppImage' } })).toBe('appimage');
  });

  it('is deb or rpm when installed under /opt and the matching package manager is present', () => {
    expect(detectPackaging({ ...base, exists: exists('/var/lib/dpkg/status') })).toBe('deb');
    expect(detectPackaging({ ...base, exists: exists('/var/lib/rpm') })).toBe('rpm');
    expect(detectPackaging({ ...base, exists: exists('/usr/lib/sysimage/rpm') })).toBe('rpm');
  });

  it('prefers deb when both managers leave files (a Debian system with rpm tools)', () => {
    expect(detectPackaging({ ...base, exists: exists('/var/lib/dpkg/status', '/var/lib/rpm') })).toBe('deb');
  });

  it('is "unpacked" on Linux when it is neither an AppImage nor installed under /opt', () => {
    expect(detectPackaging({ ...base, execPath: '/home/x/Downloads/Cashfold-linux-unpacked/cashfold', exists: exists('/var/lib/dpkg/status') })).toBe('unpacked');
    expect(detectPackaging({ ...base, exists: () => false })).toBe('unpacked');
  });
});
