# Quickstart: validating Help shows the keyboard shortcuts

Prerequisites: dependencies installed with the repo's usual pnpm flags (see the project notes), desktop build available for the Electron suite.

1. **Unit and drift tests**
   - `pnpm --filter @cashfold/platform test` (list invariants)
   - `pnpm --filter @cashfold/web test` (formatter, dialog, catalogue parity en/uk/pl)
   - `pnpm --filter @cashfold/desktop test` (drift test). Expected: green.
   - Negative check: temporarily rebind one entry in `shortcuts.ts` (or drop one from the list); the drift test fails naming it. Revert.
2. **Web (browser)**: run `e2e/ux-help.spec.ts`. Expected: Help opens the dialog in the sidebar and in the narrow-window drawer; no shortcut section; "Show the getting-started card" shows only while steps remain, "all done" line after; Escape/Close return focus to Help; axe clean in light and dark.
3. **Desktop**: run `apps/desktop/e2e/help.spec.ts` on each system available. Expected: listed keys written in that system's notation; every listed shortcut does what its name says; only Lock works when locked; a shortcut pressed with the dialog open closes it and runs the action; axe clean in light and dark.
4. **Systems run** (SC-002; the Electron e2e runs on the host only): macOS [x] (12 passed, 1 skipped: Control+Q, not applicable on macOS), Windows [ ] not run, Linux [ ] not run.
5. **Negative check result** (T013, run 2026-10-27): rebinding new transaction to J failed the drift test on all three systems naming "new-transaction (primary+N)"; adding a shell shortcut with no list entry failed it naming the action and system; dropping Export from the list failed it with "the shell handles export on darwin but the help list does not show it". Both files were restored; `shortcuts.ts` has no diff.
6. **Manual**: switch language to Ukrainian and Polish; check wrapping at narrow width and larger text; check macOS ⌃⌘F and Windows/Linux F11.

7. **Not yet done by hand**: Command+Q on macOS (the system's application menu; a synthesised key press cannot reach it), Windows and Linux runs of the Electron suite, larger system text size.
