import { describe, expect, it, vi } from 'vitest';
import { labelsFor } from './menu-labels';
import { textMenuTemplate, type TextMenuParams } from './text-menu';

const flags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
const field = (extra: Partial<TextMenuParams> = {}): TextMenuParams => ({ isEditable: true, selectionText: '', misspelledWord: '', dictionarySuggestions: [], editFlags: flags, ...extra });
const names = (items: Array<{ role?: string; type?: string; label?: string }> | null) => items?.map((item) => item.role ?? item.type ?? item.label);

describe('the right-click menu', () => {
  it('offers Cut, Copy, Paste and Select all in a text field, in the language shown', () => {
    const items = textMenuTemplate(field(), labelsFor('pl'), vi.fn());
    expect(names(items)).toEqual(['cut', 'copy', 'paste', 'separator', 'selectAll']);
    expect(items?.map((item) => item.label)).toEqual(['Wytnij', 'Kopiuj', 'Wklej', undefined, 'Zaznacz wszystko']);
  });

  it('disables what the field cannot do', () => {
    const items = textMenuTemplate(field({ editFlags: { ...flags, canCut: false, canPaste: false } }), labelsFor('en'), vi.fn());
    expect(items?.filter((item) => item.enabled === false).map((item) => item.role)).toEqual(['cut', 'paste']);
  });

  it('puts spelling suggestions first for a misspelled word, and applies the chosen one', () => {
    const replace = vi.fn();
    const items = textMenuTemplate(field({ misspelledWord: 'teh', dictionarySuggestions: ['the', 'tea'] }), labelsFor('en'), replace)!;
    expect(names(items)!.slice(0, 4)).toEqual(['the', 'tea', 'separator', 'cut']);
    (items[0]!.click as () => void)();
    expect(replace).toHaveBeenCalledWith('the');
  });

  it('offers only Copy for a value that is selected outside a field', () => {
    const items = textMenuTemplate(field({ isEditable: false, selectionText: 'A3-123' }), labelsFor('uk'), vi.fn());
    expect(names(items)).toEqual(['copy']);
    expect(items?.[0]?.label).toBe('Копіювати');
  });

  it('offers nothing anywhere else', () => {
    expect(textMenuTemplate(field({ isEditable: false }), labelsFor('en'), vi.fn())).toBeNull();
  });
});
