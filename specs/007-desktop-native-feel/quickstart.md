# Quickstart: validating Desktop Native Feel

Prerequisites: `pnpm install`, then build the web export and desktop shell as in `apps/desktop/README.md`.

1. **Unit**: `pnpm --filter @cashfold/desktop test` (menu has no template on Windows/Linux and only the app submenu on macOS; shortcut matcher table; labels in en/uk/pl; stylesheet contains the contract selectors).
2. **Web markers**: `pnpm --filter @cashfold/web test` (each copy-on-purpose value carries `data-selectable`; no rule from the stylesheet exists in the web CSS).
3. **E2E**: `pnpm --filter @cashfold/desktop e2e` runs `native-feel.spec.ts`: no application menu; Alt shows nothing; drag-select over a screen highlights nothing; selecting in a field and the Secret Key works; computed cursors per control; right-click in a field offers the text menu; dropping a file leaves the app in place; page does not scroll when it fits.
4. **Manual** (each OS): follow the Independent Test of each user story in [spec.md](spec.md); confirm shortcuts in [contracts/shortcuts-without-menu.md](contracts/shortcuts-without-menu.md); open the app in a browser and confirm nothing changed (SC-006).
5. **Accessibility**: keyboard-only and screen-reader pass of sign-in, add transaction, Settings (SC-007).
