import { describe, expect, it, vi } from 'vitest';
import { PRIMARY_COLORS } from '@cashfold/platform';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createAppIcon } from './app-icon';

const image = (id: string) => ({ id }) as never;

function setup(platform: NodeJS.Platform, load = image) {
  const setDockIcon = vi.fn();
  const setWindowIcons = vi.fn();
  return { icon: createAppIcon({ platform, setDockIcon, setWindowIcons, image: load }), setDockIcon, setWindowIcons };
}

describe('the app icon', () => {
  it('sets the dock icon on macOS and the window icons elsewhere', () => {
    const mac = setup('darwin');
    mac.icon.set('blue');
    expect(mac.setDockIcon).toHaveBeenCalledWith({ id: 'blue' });
    expect(mac.setWindowIcons).not.toHaveBeenCalled();
    for (const platform of ['win32', 'linux'] as const) {
      const other = setup(platform);
      other.icon.set('pink');
      expect(other.setWindowIcons).toHaveBeenCalledWith({ id: 'pink' });
      expect(other.setDockIcon).not.toHaveBeenCalled();
    }
  });

  it('ignores anything that is not a palette id, so no path or image is ever taken from the page', () => {
    const { icon, setDockIcon, setWindowIcons } = setup('darwin');
    for (const bad of ['../../etc/passwd', 'purple', '', 3, null, undefined, {}, 'Blue']) icon.set(bad);
    expect(setDockIcon).not.toHaveBeenCalled();
    expect(setWindowIcons).not.toHaveBeenCalled();
    expect(icon.current()).toBeUndefined();
  });

  it('does nothing when the colour has not changed, and remembers the current one', () => {
    const { icon, setWindowIcons } = setup('linux');
    icon.set('teal');
    icon.set('teal');
    expect(setWindowIcons).toHaveBeenCalledTimes(1);
    expect(icon.current()).toBe('teal');
  });

  it('is not an error when the image cannot be read, and keeps the previous colour', () => {
    const { icon } = setup('linux', (id) => { if (id === 'amber') throw new Error('missing'); return image(id); });
    icon.set('teal');
    expect(() => icon.set('amber')).not.toThrow();
    expect(icon.current()).toBe('teal');
  });

  it('has an icon file for every colour', () => {
    for (const id of PRIMARY_COLORS) expect(existsSync(join(import.meta.dirname, '..', '..', 'build', 'icons', `${id}.png`)), id).toBe(true);
  });
});
