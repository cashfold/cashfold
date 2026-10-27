import { describe, expect, it, vi } from 'vitest';
import { clampCount, createBadge, overlayImageName } from './badge';
import { labelsFor } from './menu-labels';

const image = (name: string) => ({ name }) as never;

function setup(platform: NodeJS.Platform) {
  const setBadgeCount = vi.fn();
  const setOverlay = vi.fn();
  const badge = createBadge({ platform, setBadgeCount, setOverlay, image, labels: () => labelsFor('en') });
  return { badge, setBadgeCount, setOverlay };
}

describe('the count', () => {
  it('is a whole number from 0 to 999', () => {
    expect([clampCount(5), clampCount(0), clampCount(-3), clampCount(1500), clampCount(4.9), clampCount(Number.NaN), clampCount('7'), clampCount(undefined)]).toEqual([5, 0, 0, 999, 4, 0, 0, 0]);
  });

  it('picks an overlay image of 1 to 9, and "9+" beyond', () => {
    expect([1, 5, 9, 10, 999].map(overlayImageName)).toEqual(['1', '5', '9', '9plus', '9plus']);
  });
});

describe('the badge on macOS', () => {
  it('sets the dock count, clamps it, and clears it with 0', () => {
    const { badge, setBadgeCount, setOverlay } = setup('darwin');
    badge.set(4);
    badge.set(5000);
    badge.set(0);
    expect(setBadgeCount.mock.calls).toEqual([[4], [999], [0]]);
    expect(setOverlay).not.toHaveBeenCalled();
  });
});

describe('the badge on Windows', () => {
  it('shows an overlay image with a description, "9+" from ten, and removes it at 0', () => {
    const { badge, setOverlay, setBadgeCount } = setup('win32');
    badge.set(3);
    badge.set(12);
    badge.set(0);
    expect(setOverlay.mock.calls[0]).toEqual([{ name: '3' }, '3 waiting for confirmation']);
    expect(setOverlay.mock.calls[1]).toEqual([{ name: '9plus' }, '12 waiting for confirmation']);
    expect(setOverlay.mock.calls[2]).toEqual([null, '']);
    expect(setBadgeCount).not.toHaveBeenCalled();
  });

  it('can show the count again for a window created later', () => {
    const { badge, setOverlay } = setup('win32');
    badge.set(2);
    badge.reapply();
    expect(setOverlay).toHaveBeenCalledTimes(2);
  });
});

describe('clearing', () => {
  it('removes the count at once (a system lock, quit)', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const { badge, setBadgeCount, setOverlay } = setup(platform);
      badge.set(6);
      badge.clear();
      expect(badge.current()).toBe(0);
      expect(platform === 'darwin' ? setBadgeCount.mock.lastCall : setOverlay.mock.lastCall).toEqual(platform === 'darwin' ? [0] : [null, '']);
    }
  });

  it('shows nothing on Linux', () => {
    const { badge, setBadgeCount, setOverlay } = setup('linux');
    badge.set(6);
    expect(setBadgeCount).not.toHaveBeenCalled();
    expect(setOverlay).not.toHaveBeenCalled();
  });
});
