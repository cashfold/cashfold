import { describe, expect, it } from 'vitest';
import { describeCapabilities, hasStatusItem, windowsBuildFrom, type CapabilityFacts } from './capabilities';

const facts = (change: Partial<CapabilityFacts>): CapabilityFacts => ({
  platform: 'linux',
  desktop: undefined,
  windowsBuild: undefined,
  reducedTransparency: false,
  highContrast: false,
  notifications: 'granted',
  ...change,
});

describe('capabilities', () => {
  it('on macOS: everything native, translucency active', () => {
    expect(describeCapabilities(facts({ platform: 'darwin' }))).toEqual({
      platform: 'darwin',
      lockEvents: ['screen-lock', 'suspend', 'idle-state'],
      badge: true,
      statusItem: true,
      jumpList: false,
      dockMenu: true,
      notifications: 'granted',
      translucency: 'active',
      loginItem: true,
    });
  });

  it('on Windows 11 22H2: jump list, badge, status item and Mica', () => {
    const report = describeCapabilities(facts({ platform: 'win32', windowsBuild: 22631 }));
    expect(report).toMatchObject({ badge: true, statusItem: true, jumpList: true, dockMenu: false, translucency: 'active' });
  });

  it('on Windows 10 there is no translucency', () => {
    expect(describeCapabilities(facts({ platform: 'win32', windowsBuild: 19045 })).translucency).toBe('unavailable');
    expect(describeCapabilities(facts({ platform: 'win32', windowsBuild: undefined })).translucency).toBe('unavailable');
  });

  it('reduced transparency or high contrast turns translucency to reduced', () => {
    expect(describeCapabilities(facts({ platform: 'darwin', reducedTransparency: true })).translucency).toBe('reduced');
    expect(describeCapabilities(facts({ platform: 'win32', windowsBuild: 22621, highContrast: true })).translucency).toBe('reduced');
  });

  it('on Linux: no badge, no menus, translucency unavailable, and only sleep and idle are relied on', () => {
    expect(describeCapabilities(facts({ platform: 'linux', desktop: 'KDE' }))).toMatchObject({
      badge: false,
      jumpList: false,
      dockMenu: false,
      translucency: 'unavailable',
      lockEvents: ['suspend', 'idle-state'],
    });
  });

  it.each(['KDE', 'XFCE', 'X-Cinnamon', 'MATE', 'LXQt', 'Budgie:GNOME', 'Pantheon', 'Deepin', 'ubuntu:KDE'])('shows a tray on the Linux desktop %s', (desktop) => {
    expect(hasStatusItem('linux', desktop)).toBe(true);
  });

  it.each(['GNOME', 'ubuntu:GNOME', 'Unity', '', undefined])('does not count on a tray on the Linux desktop %s', (desktop) => {
    expect(hasStatusItem('linux', desktop)).toBe(false);
  });

  it('reads the Windows build from the release string', () => {
    expect(windowsBuildFrom('10.0.22631')).toBe(22631);
    expect(windowsBuildFrom('nonsense')).toBeUndefined();
  });

  it('refuses a platform the app is not built for', () => {
    expect(() => describeCapabilities(facts({ platform: 'freebsd' }))).toThrow();
  });
});
