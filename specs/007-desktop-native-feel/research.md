# Research: Desktop Native Feel

## R1. How to remove the menu bar

- **Decision**: On Windows and Linux call `Menu.setApplicationMenu(null)` and `win.removeMenu()` / `setMenuBarVisibility(false)`; with no menu, Alt shows nothing. On macOS keep a template with only the app-name submenu (About, Hide, Hide Others, Show All, Quit), the minimum macOS requires.
- **Rationale**: Matches FR-001 and FR-002 exactly. `autoHideMenuBar` alone is rejected because Alt would still reveal it.
- **Alternatives**: hidden menu items to keep accelerators (rejected: accelerators on `visible:false` items work on macOS only and are not testable elsewhere); a fully empty macOS menu (rejected: Cmd+Q, Cmd+H and the app name need it).

## R2. Keeping shortcuts without a menu

- **Decision**: A `shortcuts.ts` table maps accelerators to actions and is run from `webContents` `before-input-event`. Chromium handles clipboard/undo natively on Windows and Linux; on macOS they are mapped to `webContents.cut/copy/paste/selectAll/undo/redo`. Window actions (close, minimise, full screen, quit) call the window or app directly. The app-action shortcuts of 006 (new transaction, lock, Settings, …) are not built yet and never depended on a menu; the table accepts them later as entries flagged `data: true`, which are dropped while the page is locked (006 FR-011). This feature adds none.
- **Rationale**: One testable table replaces five menus; it is also where 006's app-action shortcuts will live, so there is no second source of truth. A pure `match(input) → action` function is unit-testable without Electron.
- **Alternatives**: `globalShortcut` (rejected: system-wide, steals keys from other apps); page-level key handlers in the web app (rejected: the browser would change and the web bundle would grow).

## R3. Disabling text selection

- **Decision**: The shell injects a stylesheet with `insertCSS` on every `did-navigate` / `dom-ready`. Rule: `user-select: none` on `html`, then `user-select: text` on `input, textarea, [contenteditable], [data-selectable]` and their descendants.
- **Rationale**: Injection by the main process is not an inline style or script, so the Content-Security-Policy is untouched, and the web app cannot be affected. Opt-in markers make the copy-on-purpose set an explicit, reviewable list (FR-008). Assistive technology reads the DOM, not the selection, so reading and focus are unaffected (FR-009).
- **Alternatives**: a Tailwind `select-none` class on `body` toggled by a desktop component (rejected: puts platform branching in the web app); blocking `selectstart` events (rejected: breaks fields).

## R4. Cursors

- **Decision**: In the same stylesheet: `cursor: default` on `button, [role=button], [role=tab], [role=menuitem], [role=option], summary, label, select, [type=checkbox], [type=radio], [type=range]`, and rows; `cursor: text` on text inputs and `[data-selectable]`; `cursor: pointer` only on `a[href]` whose target is outside the app (external links already carry `rel="noreferrer"`/`target`); `cursor: default` on `:disabled, [aria-disabled=true]`. The window's drag region (when added) uses `-webkit-app-region: drag` with `no-drag` on controls.
- **Rationale**: Native toolkits do not use a hand on buttons; links that leave the app are the only hand (FR-013).
- **Alternatives**: per-component classes (rejected: ~50 files).

## R5. Right-click menus

- **Decision**: Electron shows no context menu by default, so no browser menu needs to be removed (FR-015 holds already for chrome). Add `text-menu.ts` on the `context-menu` event: for editable fields show Cut, Copy, Paste, Select all (and spelling suggestions when `misspelledWord` is set), with labels from `menu-labels.ts` in the app language; for `[data-selectable]` values show Copy only. The page's own row menus (006 US4) are unaffected because they run in the page.
- **Rationale**: The role labels follow the system locale, not the app's, so explicit labels keep the three languages right.

## R6. Dragging, drops, bounce, zoom

- **Decision**: `-webkit-user-drag: none` on `img, svg, a` in the injected CSS; files dropped on a non-accepting area are already stopped by the `will-navigate` lock in `security.ts` (a `file:` target is not own-origin and not an allowed external URL), verified by an e2e test and its warning log lowered so it is not noise; `overscroll-behavior: none` on `html, body`; `webContents.setVisualZoomLevelLimits(1, 1)` for pinch and Ctrl+wheel zoom is blocked.
- **Rationale**: Each is a one-line, independent change (FR-016 to FR-018).
- **Alternatives**: page `drop` handlers (rejected: browser would change).

## R7. Where menu-only actions go

- **Decision**: About, check for updates and open data folder are already in Settings (`AboutSection`, `DesktopSection`). The Help links (source, release notes, report a problem) move into `AboutSection` as external links (desktop only, shown when the bridge exists). Quit stays on Cmd/Ctrl+Q and the macOS app menu; the tray (006 US5) will add Quit when it lands. Each is within three clicks of the main screen (SC-002).
- **Alternatives**: a keyboard-shortcuts help dialog (rejected: out of scope, new UI).

## R8. Relation to spec 006

- 006's menu bar (US3 menu half, FR-009) and the menu-structure part of its `menu-and-shortcuts.md` are superseded; its shortcut table, action ids, lock rule and tray contents stand and are implemented via R2. 006 US3's tasks must be updated when this lands.
