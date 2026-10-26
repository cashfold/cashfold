import { Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';
import type { ShellLanguage } from '@cashfold/platform';
import { labelsFor, type ShellLabels } from './menu-labels';

// Electron shows no right-click menu of its own. This adds the one a native app has in a text field (and Copy on a value the person selected),
// in the language the app is shown in. Rows with a menu of their own (a transaction) are the page's and are not touched.

export interface TextMenuParams {
  readonly isEditable: boolean;
  readonly selectionText: string;
  readonly misspelledWord: string;
  readonly dictionarySuggestions: readonly string[];
  readonly editFlags: { readonly canCut: boolean; readonly canCopy: boolean; readonly canPaste: boolean; readonly canSelectAll: boolean };
}

/** The items for a right-click, or null for none. A suggestion is `{ label, replace }`, picked by the caller to apply. */
export function textMenuTemplate(params: TextMenuParams, labels: Pick<ShellLabels, 'cut' | 'copy' | 'paste' | 'selectAll'>, replace: (word: string) => void): MenuItemConstructorOptions[] | null {
  if (params.isEditable) {
    const suggestions: MenuItemConstructorOptions[] =
      params.misspelledWord === ''
        ? []
        : [...params.dictionarySuggestions.slice(0, 5).map((word): MenuItemConstructorOptions => ({ label: word, click: () => replace(word) })), { type: 'separator' }];
    return [
      ...suggestions,
      { role: 'cut', label: labels.cut, enabled: params.editFlags.canCut },
      { role: 'copy', label: labels.copy, enabled: params.editFlags.canCopy },
      { role: 'paste', label: labels.paste, enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: labels.selectAll, enabled: params.editFlags.canSelectAll },
    ];
  }
  if (params.selectionText !== '') return [{ role: 'copy', label: labels.copy }];
  return null;
}

export function installTextMenu(contents: WebContents, language: () => ShellLanguage): void {
  contents.on('context-menu', (_event, params) => {
    const template = textMenuTemplate(params, labelsFor(language()), (word) => contents.replaceMisspelling(word));
    if (template !== null) Menu.buildFromTemplate(template).popup();
  });
}
