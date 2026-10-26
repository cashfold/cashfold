import type { WebContents } from 'electron';

// What makes the window behave like an application and not a page: no selection of interface text, the pointers a native app uses, no ghost
// dragging of images, no bounce at the end of the page. The shell injects it into its own window, so the web app opened in a browser never has
// any of it, and the page's Content-Security-Policy is untouched (the stylesheet does not come from the page).
// Anything a person copies on purpose is marked `data-selectable` in the web app; fields are always selectable.

const SELECTABLE = 'input, textarea, [contenteditable], [contenteditable] *, [data-selectable], [data-selectable] *';
const TEXT_INPUTS = ['text', 'email', 'password', 'search', 'url', 'tel', 'number'].map((type) => `input[type="${type}"]:not(:disabled)`).join(', ');
const ACTIONS = [
  'button',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  'summary',
  'label',
  'select',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="range"]',
  'input[type="button"]',
  'input[type="submit"]',
  '.cursor-pointer',
  'a',
].join(', ');
const DISABLED = ':disabled, [aria-disabled="true"], [aria-disabled="true"] *';

/** The stylesheet text. The pointer rules are `!important` because the kit's own classes (such as `cursor-pointer`) are more specific. */
export function nativeFeelCss(): string {
  return [
    'html { cursor: default; user-select: none; -webkit-user-select: none; overscroll-behavior: none; }',
    'body { overscroll-behavior: none; }',
    `${SELECTABLE} { user-select: text; -webkit-user-select: text; }`,
    `${ACTIONS} { cursor: default !important; }`,
    `${TEXT_INPUTS}, input:not([type]):not(:disabled), textarea:not(:disabled), [data-selectable], [data-selectable] * { cursor: text !important; }`,
    'a[target="_blank"], a[target="_blank"] * { cursor: pointer !important; }',
    `${DISABLED} { cursor: default !important; }`,
    'img, svg, a { -webkit-user-drag: none; }',
  ].join('\n');
}

/** Injects the stylesheet into every document the window loads (a new document has none of an earlier one's rules). */
export function installNativeFeel(contents: Pick<WebContents, 'on' | 'insertCSS'>): void {
  contents.on('dom-ready', () => {
    // A failure leaves the page as a browser would show it, which is never worse than before.
    void contents.insertCSS(nativeFeelCss()).catch(() => undefined);
  });
}
