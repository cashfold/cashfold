import { describe, expect, it } from 'vitest';
import { hasUnsavedInput, type FormControl } from './unsaved-input';

const doc = (...controls: FormControl[]) => ({ querySelectorAll: () => controls });
const text = (value: string, defaultValue = ''): FormControl => ({ tagName: 'INPUT', type: 'text', value, defaultValue });

describe('whether the page holds input that is not saved', () => {
  it('is false for an empty page and for a pristine form', () => {
    expect(hasUnsavedInput(doc())).toBe(false);
    expect(hasUnsavedInput(doc(text(''), text('Everyday', 'Everyday')))).toBe(false);
  });

  it('is true when a text field differs from its default, including one that was cleared', () => {
    expect(hasUnsavedInput(doc(text('12.50')))).toBe(true);
    expect(hasUnsavedInput(doc(text('', 'Everyday')))).toBe(true);
  });

  it('is true for a textarea, a changed checkbox and a changed select', () => {
    expect(hasUnsavedInput(doc({ tagName: 'TEXTAREA', type: 'textarea', value: 'a note', defaultValue: '' }))).toBe(true);
    expect(hasUnsavedInput(doc({ tagName: 'INPUT', type: 'checkbox', value: 'on', defaultValue: 'on', checked: true, defaultChecked: false }))).toBe(true);
    expect(hasUnsavedInput(doc({ tagName: 'SELECT', type: 'select-one', value: 'b', defaultValue: '', options: [{ selected: false, defaultSelected: true }, { selected: true, defaultSelected: false }] }))).toBe(true);
  });

  it('is false for an unchanged checkbox and select', () => {
    expect(hasUnsavedInput(doc({ tagName: 'INPUT', type: 'checkbox', value: 'on', defaultValue: 'on', checked: true, defaultChecked: true }))).toBe(false);
    expect(hasUnsavedInput(doc({ tagName: 'SELECT', type: 'select-one', value: 'a', defaultValue: '', options: [{ selected: true, defaultSelected: true }, { selected: false, defaultSelected: false }] }))).toBe(false);
  });

  it('ignores a password field, so typing a password never delays the restart of a locked window', () => {
    expect(hasUnsavedInput(doc({ tagName: 'INPUT', type: 'password', value: 'secret', defaultValue: '' }))).toBe(false);
  });

  it('ignores buttons, hidden fields, file choosers and a search term, which hold no typed data', () => {
    for (const type of ['button', 'submit', 'reset', 'hidden', 'file', 'image', 'search']) expect(hasUnsavedInput(doc({ tagName: 'INPUT', type, value: 'x', defaultValue: '' }))).toBe(false);
  });

  it('ignores a radio or checkbox group that was never touched, and notices a radio that was chosen', () => {
    expect(hasUnsavedInput(doc({ tagName: 'INPUT', type: 'radio', value: 'a', defaultValue: 'a', checked: false, defaultChecked: false }))).toBe(false);
    expect(hasUnsavedInput(doc({ tagName: 'INPUT', type: 'radio', value: 'a', defaultValue: 'a', checked: true, defaultChecked: false }))).toBe(true);
  });
});
