# UI & Bridge Contract: Custom Primary Color

## Settings → Appearance
- A radio group "Primary color": one swatch per palette color plus its text name; "Default" is the first option. Arrow keys move, space selects, selection applies at once without a Save button.
- A short note under the group: installed app icons update on reinstall (shown when the app runs installed, or always as help text).
- Changing the value updates `<html data-primary>`, the tab icon, the manifest link and (desktop) the shell icon.

## Document attributes
- `<html data-theme="light|dark" data-primary="<id>">`, set before first paint. `tokens.css` defines the overrides; no `style=` attributes.

## Desktop bridge (`@cashfold/platform`)
- `setPrimaryColor(id: PaletteColorId): Promise<void>` — main validates `id` against its own list, ignores anything else, and swaps the dock/window icon. No paths or bytes cross the bridge. Best effort, never throws to the page.

## Profile sync (Phase 3)
- A protocol schema `profile` record with `primary` and an HLC stamp, versioned, with an upcaster entry. Wire details are defined in the ADR.
