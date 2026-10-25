# Research: Ukrainian and Polish Languages

## R1 — What already exists

- `ui/i18n/i18n.ts` holds `LOCALES` (`en`, `ar`, the test-only `en-XA`), `resolveLocale` (first matching browser language, base language only), and ICU formatting with English fallback per key. `ar` is an empty catalogue. Adding a language is documented there as "add a catalogue and list it".
- `I18nProvider` picks the locale once after mount from `navigator.languages` and sets `<html lang dir>`. There is no saved choice and no picker.
- Preferences (`cashfold.ui`) are device-local, parsed field by field with defaults, so a new field needs no version bump.
- Dates use `Intl.DateTimeFormat`; amounts use `separatorsFor(locale)` over `Intl.NumberFormat` and the exact `bigint` parser in `core`.
- The service worker precaches every built file under a hashed manifest, all-or-nothing.
- Hard-coded English outside the catalogue: the emergency kit HTML (`lang="en"`), the desktop menu labels, the static metadata description and manifest description.
- Existing e2e specs find controls by English label, so they cannot simply be rerun under a Ukrainian or Polish locale (unlike `rtl`, which falls back to English words).

## R2 — Decisions

**D1. Catalogue format and location.** Decision: one flat JSON file per language beside `en.json`, same keys, ICU syntax. The `error.*` messages that live in `errors/catalogue.ts` for English are placed in `uk.json`/`pl.json` as ordinary keys. Rationale: the translator edits one file per language, and the existing translator already merges by key. Alternatives: a hosted translation service (rejected: sends text to a third party and adds supply-chain surface, against principle VIII); a different i18n library (rejected: no benefit over `intl-messageformat`, which already supports plural rules for both languages).

**D2. Plurals.** Decision: rely on `Intl.PluralRules`, which gives `one/few/many/other` for both languages. English messages that use only `one/other` are translated with all four categories. A test parses each translated message and fails if a plural lacks `other`, or lacks a category the language needs and the English message pluralises on. Alternative: a hand-written plural table (rejected: error-prone, duplicates the platform).

**D3. Loading.** Decision: English stays in the main bundle (it is the fallback for every key); `uk` and `pl` load as separate chunks on demand through a dynamic import, which the static export emits as files the service worker already precaches. Until a chunk arrives the app renders English and then swaps. Rationale: two extra ~100 KB catalogues would erode the bundle budget for everyone. Alternative: bundle all (simpler, rejected for size; revisit if the budget script shows headroom).

**D4. Choosing the language.** Decision: new preference `language: 'auto' | 'en' | 'uk' | 'pl'` (default `auto` = browser order). Order of authority: saved choice, then browser languages, then English. The picker lists autonyms ("English", "Українська", "Polski") so it is findable from an unreadable UI. Placement: Settings → Appearance, and a compact picker in the footer of the pre-sign-in layout, which also fills the space the removed app-name header left. `ar` and the pseudo-locale are not offered (ar is an empty placeholder). Alternatives: a URL prefix per language (rejected: static export and a single-page local-first app gain nothing, and it leaks the choice to the server); a cookie (rejected: sent to the server for no reason).

**D5. Avoiding a flash and keeping state.** The page is prerendered in English and the locale is applied after mount today; that behaviour stays (no inline script, so the CSP hash list does not change). Switching language only changes the translator in context, so route, form state and scroll are kept. The saved preference is read through the existing prefs store, which is available before sign-in.

**D6. Amount input.** Finding: Polish and Ukrainian print `1 234,56` with a no-break space as group separator and a comma as decimal separator. People type a normal space, or a dot as decimal, and the exact parser rejects both. Decision: a small normaliser in `ui/ledger/format.ts` runs before `parseMoney`: any whitespace variant (space, no-break, narrow no-break) is treated as the locale's group separator, and `.` is accepted as the decimal separator when the locale's decimal is `,` and its group is not `.`. The exact parser in `core` is unchanged. Rationale: keeps `core` locale-free (principle II) and the money path float-free (VI). Printing is unchanged.

**D7. Sorting and search.** Finding: name ordering is done in `core` queries (`byOrder`, `byName` in `ledger/application/queries.ts`) with `compareText`, a plain code-unit comparison. That is deliberate (queries are deterministic and `core` is locale-free), but it puts `Ł`, `Ż`, `Ґ`, `Є` and `Ї` after the end of their alphabets. Decision: leave `core` unchanged (principle II, and projections must not depend on the viewer's locale). Where a screen shows a list ordered by name rather than by the person's own `sortOrder` (payees, tags, category pickers, suggestion lists), re-order it in the UI with `Intl.Collator(locale)`; lists that follow `sortOrder` are left alone. Search compares with `sensitivity: 'base'` so `l` finds `ł`. A task audits the screens that render name-sorted lists. Alternative: pass a collator into `core` (rejected: breaks determinism and the no-I/O/no-locale rule).

**D8. Outside the page.**
- Emergency kit: `buildEmergencyKitHtml` takes the translator and locale; `lang` and `dir` are set from them; the file is self-contained as before.
- Desktop menu: labels move to a small catalogue keyed by language; the main process starts from `app.getLocale()` and updates through one validated, enum-only channel when the person changes the in-app language. Roles (undo, copy, …) are already localised by the OS.
- Static metadata (`description`) and `manifest.webmanifest` cannot vary per person in a static export. Decision: keep the brand name (not translated) and make the descriptions language-neutral or remove them. This narrows FR-009 for the installed-app description; the spec's assumption list is updated accordingly (see Spec adjustments).
- Server: it is a relay that returns error kinds, not text, so every message a person reads is already produced on the client from `error.*` keys. Nothing to translate server-side.

**D9. Completeness gate.** Decision: a Vitest file (runs in the existing unit job, so it blocks merge) that, for each of `uk` and `pl`: (a) every English key exists and no extra keys do, (b) the set of ICU argument names equals the English one, (c) tag/placeholder parity, (d) plural categories as in D2, (e) no value is identical to English except an allowlist (brand, currency codes, "OK"). Missing at release is an error; the runtime English fallback remains only as a safety net. Alternative: warn only (rejected by spec FR-013).

**D10. Translation sourcing and terminology.** Decision: produce a first draft, listed from the first release (clarified 2026-10-25), with native-speaker review per language following within one release cycle (spec SC-007). One glossary ([contracts/glossary.md](contracts/glossary.md)) fixes the finance terms first so drafts stay consistent. "Fold" is the product's own coined term; clarified on 2026-10-25: it gets a local word in both languages, chosen once by the reviewers. Machine translation is allowed as a draft; reviewer corrections ship as normal updates.

**D11. Fonts.** The bundled Ubuntu faces already include Latin-ext (Polish diacritics) and Cyrillic (Ukrainian incl. `Ї Є Ґ І`) with `unicode-range` subsetting, so no new font is needed. A check confirms `Ґ ґ Є є І і Ї ї` and `Ą Ć Ę Ł Ń Ó Ś Ź Ż` render from Ubuntu rather than a fallback face. Only the Latin 400/500 files are preloaded; Cyrillic loads on demand, which is acceptable.

**D12. Testing approach.** Existing specs are tied to English labels, so a dedicated `e2e/language.spec.ts` covers: detection (browser `uk`, `pl`), manual switch, persistence, switch before sign-in, offline switch, no horizontal overflow at 320 px on each main route, and axe in both languages. The `rtl` and `pseudo` projects stay as they are.

## Spec adjustments recommended

- FR-009: replace "installed-app name and description" with "the installed-app name stays the brand; descriptions are language-neutral", because a static export cannot localise them per person.
- Done 2026-10-25 (analysis fixes): FR-009 reworded; the amount-input edge case added; CSV headers fixed; page title stays the brand (FR-008).
