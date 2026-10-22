import { describe, expect, it } from 'vitest';
import { decideUpdateMode } from './update-mode';

// Which installs can update themselves, and which must send the person to the release page (FR-014, FR-015, research R-D-10).

describe('how an installed copy updates', () => {
  it.each([
    ['win32', 'nsis', false],
    ['win32', 'nsis', true],
    ['linux', 'appimage', false],
    ['linux', 'appimage', true],
    ['darwin', 'dmg', true],
  ] as const)('%s %s (signed: %s) updates in the app', (platform, packaging, signed) => {
    expect(decideUpdateMode({ platform, packaging, signed })).toBe('in-app');
  });

  it.each([
    ['linux', 'deb', false],
    ['linux', 'deb', true],
    ['linux', 'rpm', false],
    ['linux', 'rpm', true],
    ['darwin', 'dmg', false],
    ['win32', 'unpacked', true],
    ['linux', 'unpacked', true],
    ['darwin', 'unpacked', true],
  ] as const)('%s %s (signed: %s) shows how to update by hand', (platform, packaging, signed) => {
    expect(decideUpdateMode({ platform, packaging, signed })).toBe('manual');
  });

  it('never claims an in-app update for a system it does not know', () => {
    expect(decideUpdateMode({ platform: 'freebsd', packaging: 'nsis', signed: true })).toBe('manual');
    expect(decideUpdateMode({ platform: 'linux', packaging: 'snap', signed: true })).toBe('manual');
  });
});
