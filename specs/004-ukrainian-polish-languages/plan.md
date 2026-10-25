# Implementation Plan: Ukrainian and Polish Languages

**Branch**: `004-ukrainian-polish-languages` | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-ukrainian-polish-languages/spec.md`

## Summary

Add `uk` and `pl` catalogues to the existing localisation system (bundled ICU catalogues, `intl-messageformat`, locale chosen
on the client) and let people choose a language by hand. The work is mostly content (about 1,300 English messages translated
twice) plus four small pieces of code: a language preference with a picker (settings and the pre-sign-in screens), lazy loading
of non-English catalogues, tolerant amount input for locales whose group separator is a space, and a completeness check that
fails CI on missing keys or mismatched placeholders and plural forms. The emergency kit and the desktop menu, both hard-coded
in English today, are made to follow the language. No change to `crypto`, `protocol` or the server; `core` gets one backward-compatible optional input (localised starter category names, FR-015) and stays free of text and locale.

## Technical Context

**Language/Version**: TypeScript (strict), React 19 / Next.js App Router static export, Electron shell for desktop

**Primary Dependencies**: existing `intl-messageformat` and the browser `Intl` APIs; no new dependency

**Storage**: device-local interface preferences (`cashfold.ui` in localStorage), one new field; nothing synced, nothing in the ledger

**Testing**: Vitest (catalogue completeness, plural, separators, preference parsing), Playwright (language spec on Chromium), axe

**Target Platform**: web (static export, service-worker precache, offline) and the Electron desktop app

**Project Type**: web application + desktop shell (monorepo)

**Performance Goals**: language switch visible in under 1 s; first paint in English-default case unchanged

**Constraints**: bundle-size budget (CI gate); catalogues must be available offline; exact money parsing; strict CSP (no new inline script)

**Scale/Scope**: about 1,340 keys × 2 languages; about 25 source files touched, 2 new catalogues, 1 new picker component

All unknowns are resolved in [research.md](research.md).

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design, still passed.*

| Principle | Result |
|-----------|--------|
| I Zero-knowledge | Pass. The language choice stays on the device; the server learns nothing new and sends no text. |
| II DDD in `core` | Pass. Language is a UI concern. The one domain touch is an optional `names` input on `defaultCategories` (ids and keys unchanged, no text, locale or I/O enters `core`). Parsing tolerance lives in the web layer, not in `core`. |
| III Hexagonal | Pass. Only UI/adapter layers change; boundary lint unaffected. |
| IV CQRS / V Event sourcing | N/A. No events or projections; the preference is not in the event log. |
| VI Exact money | Pass. Input normalisation happens before the existing exact `bigint` parser; no floats introduced (guarded by existing lint and a new test with values beyond 2^53). |
| VII Local-first | Pass. Catalogues are in the precached build, so switching language works offline (verified by an offline e2e step). |
| VIII Security hygiene | Pass. No third-party code, no inline script added (the CSP hash list is unchanged), translations are plain data rendered as text. |
| IX Simplicity | Pass. One lazy-load seam and one picker; no i18n framework swap. See Complexity Tracking (none required). |
| Quality gates | Tests first for the check and separators; axe and e2e for P1/P2; i18n is part of the definition of done. |

## Project Structure

### Documentation (this feature)

```text
specs/004-ukrainian-polish-languages/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── catalogue-contract.md
│   ├── language-preference.md
│   └── glossary.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/src/ui/i18n/
├── i18n.ts                    # LOCALES gains uk, pl; LANGUAGE_NAMES; lazy catalogue loader
├── I18nProvider.tsx           # resolve: saved choice > browser > en; loads catalogue; exposes setLanguage
├── LanguagePicker.tsx         # new: kit Select listing autonyms
├── messages/
│   ├── en.json                # source of truth
│   ├── uk.json                # new (includes the error.* keys now only in errors/catalogue.ts)
│   └── pl.json                # new
└── catalogue-complete.test.ts # new: keys, placeholders, plural categories

apps/web/src/ui/prefs/schema.ts            # + language: 'auto' | Locale
apps/web/src/ui/settings/AppearanceSection.tsx   # + Language fieldset
apps/web/src/ui/kit/auth-layout.tsx        # + footer slot for the picker on pre-sign-in pages
apps/web/src/ui/auth/SignUpForm.tsx        # sends localised starter Fold name and category names (FR-015)
apps/web/src/worker/app-handlers.ts        # passes the starter names through account and Fold creation
packages/core/src/ledger/{domain/default-categories.ts,application/category-commands.ts}  # optional `names` input; ids unchanged
apps/web/src/ui/shell/AppShell.tsx         # PlainShell renders the picker
apps/web/src/ui/ledger/format.ts           # tolerant amount input (spaces, alternate decimal)
apps/web/src/ui/ledger/ (name-sorted lists)  # re-order by Intl.Collator(locale) in the UI; core stays code-unit ordered
apps/web/src/ui/emergency-kit/kit.ts       # takes a translator and locale instead of literal English
apps/desktop/src/main/menu.ts              # labels from a small catalogue; rebuilt on a language message
apps/desktop/src/main/problem-message.ts   # start-up error dialog follows the OS language (no window yet)
apps/desktop/src/preload, main/index.ts    # one validated channel carrying the language
e2e/language.spec.ts                       # new
e2e/pseudo-walk.spec.ts                    # new: walks every route under en-XA and flags untransformed (hard-coded) text
```

**Structure Decision**: extend the existing `ui/i18n` module in place. No new package, because the catalogue is UI-only and
`core` stays free of text.

## Complexity Tracking

No constitution violations. Two deliberate additions, both small and recorded here for review: lazy loading of non-default
catalogues (to hold the bundle budget) and one desktop IPC channel (so the menu follows an in-app choice).
