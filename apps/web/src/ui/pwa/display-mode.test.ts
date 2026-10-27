import { describe, expect, it } from 'vitest';
import { isInstalledWindow } from './display-mode';

const env = (matches: boolean | undefined, standalone?: boolean) => ({
  ...(matches === undefined ? {} : { matchMedia: (query: string) => ({ matches: query === '(display-mode: standalone)' && matches }) }),
  navigator: { standalone } as { standalone?: boolean },
});

describe('whether the app runs as an installed app', () => {
  it('is true when the standalone display mode matches', () => {
    expect(isInstalledWindow(env(true))).toBe(true);
  });

  it('is true on iPhone and iPad, where the home screen app reports navigator.standalone', () => {
    expect(isInstalledWindow(env(false, true))).toBe(true);
  });

  it('is false in a normal browser tab', () => {
    expect(isInstalledWindow(env(false))).toBe(false);
    expect(isInstalledWindow(env(false, false))).toBe(false);
  });

  it('is false, not an error, where matchMedia is missing', () => {
    expect(isInstalledWindow(env(undefined))).toBe(false);
  });
});
