import { describe, expect, it } from 'vitest';
import { isApplePlatform, isPaletteKey, otherDialogOpen, paletteShortcutText, type KeyLike } from './palette-keys';

const press = (over: Partial<KeyLike> = {}): KeyLike => ({ key: 'k', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...over });

describe('the browser key that opens the palette', () => {
  it('is Command+K on an Apple system and Control+K elsewhere', () => {
    expect(isPaletteKey(press({ metaKey: true }), true)).toBe(true);
    expect(isPaletteKey(press({ ctrlKey: true }), false)).toBe(true);
    expect(isPaletteKey(press({ ctrlKey: true }), true)).toBe(false);
    expect(isPaletteKey(press({ metaKey: true }), false)).toBe(false);
    expect(isPaletteKey(press({ ctrlKey: true, metaKey: true }), true)).toBe(false);
  });

  it('takes a capital K as well, for caps lock', () => {
    expect(isPaletteKey(press({ key: 'K', ctrlKey: true }), false)).toBe(true);
  });

  it('does not match with Shift or Alt, another key, or a bare K', () => {
    expect(isPaletteKey(press({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isPaletteKey(press({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isPaletteKey(press({ ctrlKey: true, key: 'j' }), false)).toBe(false);
    expect(isPaletteKey(press(), false)).toBe(false);
  });

  it('ignores a press someone else already handled, or one made while composing text', () => {
    expect(isPaletteKey(press({ ctrlKey: true, defaultPrevented: true }), false)).toBe(false);
    expect(isPaletteKey(press({ ctrlKey: true, isComposing: true }), false)).toBe(false);
  });
});

describe('the platform and the shortcut as written', () => {
  it('tells an Apple system from the others', () => {
    expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isApplePlatform({ platform: 'iPhone' })).toBe(true);
    expect(isApplePlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe(true);
    expect(isApplePlatform({ platform: 'Win32' })).toBe(false);
    expect(isApplePlatform({ platform: 'Linux x86_64' })).toBe(false);
    expect(isApplePlatform({})).toBe(false);
  });

  it('writes the shortcut as the system writes it', () => {
    expect(paletteShortcutText(true)).toBe('⌘K');
    expect(paletteShortcutText(false)).toBe('Ctrl+K');
  });
});

describe('another dialog being open', () => {
  const doc = (dialogs: number) => ({ querySelectorAll: (selector: string) => ({ length: selector.includes(':not([data-palette])') ? dialogs : dialogs + 1 }) as unknown as NodeListOf<Element> });

  it('asks only about dialogs that are not the palette itself', () => {
    expect(otherDialogOpen(doc(0))).toBe(false);
    expect(otherDialogOpen(doc(1))).toBe(true);
  });
});
