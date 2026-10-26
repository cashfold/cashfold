import { describe, expect, it } from 'vitest';
import { applySettingsUpdate, defaultSettings, sanitiseSettings } from './desktop-settings';
import { sanitiseDesktopState } from './desktop-state';

const SCREEN = { x: 0, y: 0, width: 1920, height: 1080 };

describe('desktop settings defaults', () => {
  it('keeps running in the background on macOS and quits on Windows and Linux', () => {
    expect(defaultSettings('darwin')).toEqual({ hideOnBlur: false, startAtLogin: false, closeBehavior: 'background', theme: 'system' });
    expect(defaultSettings('win32').closeBehavior).toBe('quit');
    expect(defaultSettings('linux').closeBehavior).toBe('quit');
  });
});

describe('sanitising settings', () => {
  it('gives the defaults for missing or malformed input', () => {
    for (const raw of [undefined, null, 4, 'x', [], true]) expect(sanitiseSettings(raw, 'linux'), String(raw)).toEqual(defaultSettings('linux'));
  });

  it('keeps good values', () => {
    const raw = { hideOnBlur: true, startAtLogin: true, closeBehavior: 'background', theme: 'dark' };
    expect(sanitiseSettings(raw, 'win32')).toEqual(raw);
  });

  it('replaces only the bad field and drops unknown keys', () => {
    const result = sanitiseSettings({ hideOnBlur: 'yes', startAtLogin: true, closeBehavior: 'minimise', theme: 'light', extra: 1 }, 'darwin');
    expect(result).toEqual({ hideOnBlur: false, startAtLogin: true, closeBehavior: 'background', theme: 'light' });
  });

  it('is part of the saved state, field by field, with the platform default', () => {
    expect(sanitiseDesktopState({ theme: 'dark', closeBehavior: 7 }, [SCREEN], 'win32')).toMatchObject({ theme: 'dark', closeBehavior: 'quit', hideOnBlur: false });
    expect(sanitiseDesktopState({ width: 900 }, [SCREEN], 'darwin')).toMatchObject({ closeBehavior: 'background', width: 900 });
  });
});

describe('applying a change', () => {
  const current = defaultSettings('linux');

  it('changes only what was asked', () => {
    expect(applySettingsUpdate(current, { hideOnBlur: true }, true)).toEqual({ ...current, hideOnBlur: true });
  });

  it('allows staying in the background where a status item exists', () => {
    expect(applySettingsUpdate(current, { closeBehavior: 'background' }, true).closeBehavior).toBe('background');
  });

  it('stores quit instead of background where there is no status item', () => {
    expect(applySettingsUpdate(current, { closeBehavior: 'background' }, false).closeBehavior).toBe('quit');
    expect(applySettingsUpdate({ ...current, closeBehavior: 'background' }, { startAtLogin: true }, false)).toMatchObject({ closeBehavior: 'quit', startAtLogin: true });
  });
});
