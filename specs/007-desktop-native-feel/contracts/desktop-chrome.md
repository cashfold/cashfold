# Contract: Desktop window chrome

## Application menu

| Platform | Menu |
|---|---|
| Windows, Linux | none (`getApplicationMenu()` is null; the window has no menu; Alt does nothing) |
| macOS | one submenu named after the app: About, separator, Hide, Hide Others, Show All, separator, Quit. No other top-level item. |

## Injected stylesheet (selectors are the contract; values in `native-feel.ts`)

| Rule | Selector | Property |
|---|---|---|
| no selection | `html` | `user-select: none` |
| selection kept | `input, textarea, [contenteditable], [data-selectable]` and descendants | `user-select: text` |
| arrow on actions | buttons, `[role=button|tab|menuitem|option]`, `summary`, `label`, selects, checkboxes, radios, range, disabled and `aria-disabled` | `cursor: default` |
| text cursor | text-type inputs, `textarea`, `[data-selectable]` | `cursor: text` |
| hand | `a[href]` that leaves the app | `cursor: pointer` |
| no drag ghost | `img, svg, a` | `-webkit-user-drag: none` |
| no bounce | `html, body` | `overscroll-behavior: none` |

Injected on every navigation of the main window by the main process. The web app never contains these rules.

## Text-field context menu

Editable field: Cut, Copy, Paste, Select all (+ spelling suggestions). `[data-selectable]` value: Copy. Anything else: no menu. Labels in the app language.

## Web app markup

`data-selectable` (inert in a browser) on copy-on-purpose values. Adding it never changes browser behaviour.
