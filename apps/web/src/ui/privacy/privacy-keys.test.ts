import { describe, expect, it } from 'vitest';
import type { KeyLike } from '../palette/palette-keys';
import { isPrivacyKey } from './privacy-keys';

const press = (over: Partial<KeyLike> = {}): KeyLike => ({ key: 'M', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false, defaultPrevented: false, ...over });

describe('the browser key that turns Privacy mode on and off', () => {
  it('is Command+Shift+M on an Apple system and Control+Shift+M elsewhere', () => {
    expect(isPrivacyKey(press({ metaKey: true }), true)).toBe(true);
    expect(isPrivacyKey(press({ ctrlKey: true }), false)).toBe(true);
    expect(isPrivacyKey(press({ ctrlKey: true }), true)).toBe(false);
    expect(isPrivacyKey(press({ metaKey: true }), false)).toBe(false);
    expect(isPrivacyKey(press({ ctrlKey: true, metaKey: true }), true)).toBe(false);
  });

  it('takes a lower-case m as well, for a layout that reports it so', () => {
    expect(isPrivacyKey(press({ key: 'm', ctrlKey: true }), false)).toBe(true);
  });

  it('needs Shift, so Mod+M alone (minimise in the desktop app) is never taken', () => {
    expect(isPrivacyKey(press({ ctrlKey: true, shiftKey: false }), false)).toBe(false);
    expect(isPrivacyKey(press({ metaKey: true, shiftKey: false }), true)).toBe(false);
  });

  it('does not match with Alt, another key, or a bare M', () => {
    expect(isPrivacyKey(press({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isPrivacyKey(press({ ctrlKey: true, key: 'K' }), false)).toBe(false);
    expect(isPrivacyKey(press(), false)).toBe(false);
  });

  it('ignores a press someone else already handled, or one made while composing text', () => {
    expect(isPrivacyKey(press({ ctrlKey: true, defaultPrevented: true }), false)).toBe(false);
    expect(isPrivacyKey(press({ ctrlKey: true, isComposing: true }), false)).toBe(false);
  });
});
