# Contract: language choice

- **Stored as**: `language` in the `cashfold.ui` preferences object, values `auto | en | uk | pl`.
- **Resolution**: `en|uk|pl` → that language. `auto` → first browser language whose base language is supported, in the browser's order (regional tags such as `pl-PL`, `uk-UA` map to the base); else `en`.
- **Picker**: lists `English`, `Українська`, `Polski` plus `Automatic` (the last one translated). Available in Settings → Appearance and on the sign-up page only (narrowed by spec 005; no other page offers it). It is a kit `Select` with an accessible name that is translated and a visible, always-reachable control.
- **On change**: persists, swaps the translator, sets `<html lang>`, keeps route and form state, and (desktop) sends the language to the main process.
- **Desktop channel**: one renderer→main message carrying exactly one of `en | uk | pl`; the main process ignores anything else.
- **Not allowed**: syncing the value, sending it to the server, putting it in a URL or cookie.
