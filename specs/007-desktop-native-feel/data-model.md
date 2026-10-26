# Data Model: Desktop Native Feel

No stored, synced or transmitted data changes (FR-021). The only new definitions are in-memory:

- **Shortcut**: `{ accelerator, action }`. `accelerator` is a platform-resolved key combination (`CmdOrCtrl` rules as in 006). `action` is one of: a clipboard/undo edit, a window action (`close`, `minimize`, `toggle-fullscreen`, `quit`), or a 006 action id (`new-transaction`, `lock`, `settings`, `search`, `go:*`, `import`, `export`). Closed set; unknown input is ignored. Data actions are dropped while the session is locked.
- **Copy-on-purpose marker**: the attribute `data-selectable` on an element. Opt-in; absence means not selectable. Initial set: Secret Key, Emergency Kit text, server address, device pairing details, error-message details.
- **Text-menu labels**: Cut, Copy, Paste, Select all, per language (en, uk, pl), in `menu-labels.ts`.
