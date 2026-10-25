# ADR-0011: Ukrainian and Polish, a device-local language choice, and lazily loaded catalogues

- **Status**: accepted
- **Date**: 2026-10-25
- **Decides**: `specs/004-ukrainian-polish-languages` research D1, D3, D4, D6, D7, D8; FR-001 to FR-015

## Context

The app had a working localisation system (ICU messages formatted on the device, a catalogue per language, English as the fallback) but only English, an empty right-to-left placeholder, and no way to choose a language by hand. Two languages were added. Three things had to be decided: how a person chooses, how the catalogues are shipped without breaking the bundle budget or offline use, and where the language-dependent behaviour of money, names and the desktop shell lives.

## Decision

- **Choice.** A `language` preference (`auto`, `en`, `uk`, `pl`) in the device-local interface preferences. `auto` follows the browser's languages. The picker lists each language in its own language and is on Settings and on the sign-up page only (spec 005 narrowed this: it was first offered on every page before sign-in). It is never synced, never exported and never sent to the service, and it is not part of the ledger.
- **Loading.** English stays in the main bundle (it is the fallback for every key). Other catalogues are separate chunks loaded with a dynamic import and listed in the service worker's precache, so switching works offline. `scripts/check-bundle-size.mjs` counts them apart from code, each limited to 40 KiB gzipped, and fails if any built chunk is missing from the precache.
- **Completeness.** A unit test (`catalogue-complete.test.ts`) fails the build for a missing or extra key, a message that does not parse, different placeholders, a missing plural form, an untranslated value, or a missing starter name. An end-to-end walk in the pseudo-locale fails on text that did not come from the catalogue.
- **Money input.** Before the exact parser, the web layer maps ordinary, no-break and narrow no-break spaces to the locale's thousands mark and a dot to the decimal mark when that cannot be ambiguous. `core` and the exact `bigint` parsing are unchanged.
- **Names.** `core` keeps ordering names by character code (queries must give the same answer to everyone). Lists ordered by name are re-ordered in the UI with `Intl.Collator`; searching folds case and accents.
- **Starter names.** `defaultCategories` and `seedDefaultCategories` take an optional map from the stable key to a display name. Ids and keys still come from the English names, so devices in different languages write the same records.
- **Desktop.** One new bridge call, `setLanguage`, carries one of a closed list of codes (never free text); the shell rebuilds its menu. The start-up error dialog uses the operating system's language.

## Alternatives rejected

- A translation service or a different i18n library: sends text to a third party or adds a dependency for no gain over `intl-messageformat` (constitution VIII, IX).
- A language in the URL or in a cookie: a static single-page local-first app gains nothing, and it would tell the server.
- All catalogues in the main bundle: about 60 KiB more for everyone.
- Locale-aware ordering inside `core`: breaks determinism and keeps `core` free of locale.
- Keeping "Fold" in English: decided with the product owner that it gets a local word in both languages.

## Consequences

Adding a language is a catalogue, an entry in a few lists and a review ([docs/i18n.md](../i18n.md)). Reviewer corrections to the first Ukrainian and Polish drafts ship as normal updates. A bridge call was added to the desktop contract (`specs/003-desktop-apps-releases/contracts/desktop-bridge.md`).
