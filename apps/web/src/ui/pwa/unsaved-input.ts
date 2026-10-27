// Whether the page holds input a person typed and has not saved (spec 009, FR-008). A new version is never switched to while this is true. It is a scan of
// the page, not a list each form joins: every form is covered, including the add sheet, and it errs on the side of waiting.

export interface FormControl {
  readonly tagName: string;
  readonly type?: string;
  readonly value: string;
  readonly defaultValue: string;
  readonly checked?: boolean;
  readonly defaultChecked?: boolean;
  readonly options?: ReadonlyArray<{ readonly selected: boolean; readonly defaultSelected: boolean }>;
}

interface Scannable {
  querySelectorAll(selector: string): Iterable<FormControl>;
}

/** Controls that hold no typed input: buttons, hidden values, file choosers. A password is not data to save either: typing one never holds up a restart.
   A search term is not data either: nothing is lost if it goes. */
const NOT_INPUT = new Set(['button', 'submit', 'reset', 'hidden', 'file', 'image', 'password', 'search']);

const changed = (c: FormControl): boolean => {
  if (c.tagName === 'SELECT') return (c.options ?? []).some((o) => o.selected !== o.defaultSelected);
  if (c.type === 'checkbox' || c.type === 'radio') return c.checked !== c.defaultChecked;
  return c.value !== c.defaultValue;
};

export function hasUnsavedInput(doc: Scannable = document as unknown as Scannable): boolean {
  for (const control of doc.querySelectorAll('input, textarea, select')) {
    if (control.tagName !== 'SELECT' && control.type !== undefined && NOT_INPUT.has(control.type)) continue;
    if (changed(control)) return true;
  }
  return false;
}
