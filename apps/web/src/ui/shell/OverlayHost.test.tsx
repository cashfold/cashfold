import { describe, expect, it } from 'vitest';
import { PORTAL_ROOT_ID, coverPortals } from './OverlayHost';

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
  };
}

describe('coverPortals', () => {
  it('makes the overlay layer inert and hidden while the privacy cover shows, so typed values stay mounted but unreachable', () => {
    const root = fakeRoot();
    coverPortals(root, true);
    expect(root.attrs.get('inert')).toBe('');
    expect(root.attrs.get('aria-hidden')).toBe('true');
  });

  it('gives the layer back when the cover goes away', () => {
    const root = fakeRoot();
    coverPortals(root, true);
    coverPortals(root, false);
    expect(root.attrs.size).toBe(0);
  });

  it('does nothing when there is no overlay layer yet', () => {
    expect(() => coverPortals(null, true)).not.toThrow();
  });

  it('targets the layer Headless UI renders its dialogs into', () => {
    expect(PORTAL_ROOT_ID).toBe('headlessui-portal-root');
  });
});
