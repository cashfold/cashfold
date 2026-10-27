# Research: Help Shows the Keyboard Shortcuts

## R1. Where does the list live, and how is drift made impossible?
- **Decision**: One declarative list in `packages/platform` (`help-shortcuts.ts`). The web UI renders it. A test in `apps/desktop` compares it with `SHORTCUTS` in both directions for darwin, win32 and linux.
- **Rationale**: Web and desktop cannot import each other; `packages/platform` is already the shared, dependency-free contract between them. Testing from the desktop side lets the test call the real `matchShortcut` rather than a copy.
- **Alternatives**: (a) Derive the shell's table from the list: rejected, it would touch the working key handling the spec says not to change. (b) Duplicate the list in the web app and compare by text: rejected, drift then shows up only in the test. (c) Expose the shell's table to the page over the bridge: rejected, adds IPC surface for static data and cannot work in unit tests.

## R2. What counts as "the shortcuts the app handles"?
- **Decision**: Three sources, each checked differently:
  1. Shell table entries (not `development`): the drift test requires each to appear in the list with the same action and keys, and each list entry flagged `via: 'shell'` to match the table.
  2. Shortcuts the system handles (macOS Command+Q via the app menu; undo, redo, cut, copy, paste, select all on Windows and Linux via Chromium): listed with `via: 'system'`. Not matchable in the table, so the drift test pins them to an explicit allow-list in the test and an e2e step checks they work.
  3. Development-only entries (reload, developer tools): excluded; the test asserts they stay excluded.
- **Rationale**: Honest about who handles the key, while still failing when a shell entry is added, removed or rebound.

## R2a. How the drift test compares
- **Decision**: The list's `action` values for `standard` entries are the shell's own action names (`undo`, `redo`, `cut`, `copy`, `paste`, `select-all`, `zoom-in`, `zoom-out`, `zoom-reset`, `close`, `minimize`, `toggle-fullscreen`, `quit`), declared as a closed set in `packages/platform`. The test compares by action, modifier and system: for each shell table entry it presses every key the entry owns (so `+` and `=` for zoom in) and requires `matchShortcut` to return that action, and requires a list entry with the same action for that system.
- **Rationale**: Aliases such as `=` for zoom in are the shell's business; the person needs one way written once.

## R3. Redo keys on Windows and Linux (outstanding from clarify)
- **Decision**: Show Ctrl+Shift+Z on Windows and Linux (⇧⌘Z on macOS, which the shell handles).
- **Rationale**: Same key shape on every system; Chromium accepts it in text fields. Ctrl+Y also works on Windows but is not listed (one way is enough). An e2e step confirms Ctrl+Shift+Z redoes in a field on the system running the suite.
- **Alternatives**: Ctrl+Y on Windows: rejected, adds a per-system difference without benefit.

## R4. Where is the dialog owned, and how does focus return to Help?
- **Decision**: The Help sidebar item owns its open state and renders the kit `Dialog`. It exists in the fixed sidebar and again in the drawer; each owns its own dialog.
- **Rationale**: Headless UI returns focus to the element that opened the dialog, which is the Help item that rendered it. In the drawer the drawer stays open beneath (nested dialogs are supported) so the Help item still exists to receive focus; closing the dialog leaves the person where they were.
- **Alternatives**: One dialog in the shell with a shared store: rejected, focus return would need manual bookkeeping and the drawer would have to close first, losing the element to return to.

## R5. Shortcut while the dialog is open (clarified: close, then run)
- **Decision**: The shell already sends app actions to the page. `DesktopActions` closes any open help dialog (a tiny module-level open/close signal in `HelpDialog`) before `performMenuAction`. Lock needs no special case: locking unmounts the unlocked shell, which removes the dialog (FR-015).
- **Narrow window**: the same signal also closes the navigation drawer, so the action does not run behind an open drawer that makes the page inert. The signal is therefore a general `dismissOverlays` that `HelpDialog` and the sidebar layout both subscribe to.
- **Rationale**: The key press is handled in the main process before the page, so the dialog cannot intercept it; closing on arrival is the only place that sees every action. Standard shortcuts (zoom, copy, minimise...) act on the window and need no change.
- **Alternatives**: Ignoring shortcuts while open: rejected by the clarification.

## R6. Getting-started button vs. "all done"
- **Decision**: Extract the "steps left?" computation now inside `FirstRunChecklist` (counts of Folds, accounts, transactions via `checklistState`) into one small hook used by both the card and the dialog. The dialog shows the button while `complete` is false, the all-done line when true, and nothing while counts are still loading except a stable placeholder-free layout (the section appears once known).
- **Rationale**: One definition of "done" so the dialog and the card cannot disagree. Pressing the button does what Help did before: clear the dismissed flag, go to Overview, close the dialog.
- **Alternatives**: Re-query inside the dialog independently: rejected, a second definition of "done".

## R7. Notation per system
- **Decision**: A pure formatter turns `{modifiers, key}` plus the platform into text: macOS symbols in the system order (⌃ ⌥ ⇧ ⌘, then the key, no separators), others as `Ctrl+Shift+I`. The accessible name spells the keys out ("Command N" / "Control N") so a screen reader does not depend on how symbols are pronounced.
- **Rationale**: Matches the spec examples (⌘N, ⇧⌘I, ⌃⌘F, F11) and makes the keys readable to assistive technology.

## R8. Accessibility and localisation
- **Decision**: The shortcuts render as a description list inside labelled groups (name = term, keys = description, keys in `kbd`). Dark/light contrast uses existing tokens. All strings go through the existing catalogue with en/uk/pl; the existing completeness test enforces parity. The pseudo-locale and long-translation layout are covered by the existing pseudo walk plus a wrap check in the new e2e.
- **Rationale**: Reuses proven patterns; no new design tokens.

## R9. Browser behaviour
- **Decision**: The shortcut part is rendered only when `useDesktop().isDesktop` and a platform is known. In a browser the dialog contains only the getting-started part.
- **Rationale**: FR-006; detection already exists.
