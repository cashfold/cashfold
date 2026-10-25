---

description: "Task list for Ukrainian and Polish languages"
---

# Tasks: Ukrainian and Polish Languages

**Input**: Design documents in `/specs/004-ukrainian-polish-languages/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: Included. The spec requires a completeness gate (FR-013) and the constitution requires e2e coverage for P1/P2 stories and test-first work on money paths.

**Format**: `- [ ] T### [P?] [US?] Description with file path` — `[P]` = different files, no dependency on an unfinished task.

**Paths**: web code under `apps/web/src/ui/…`, desktop under `apps/desktop/src/…`, shared domain under `packages/core/src/…`, e2e under `e2e/`.

**Counts used below**: the English catalogue has 1,337 keys. Groups by prefix: ledger 428, sharing 114, settings 98, account 89, data 82, schedules 67, budgets 56, then 38 smaller groups.

---

## Phase 1: Setup

- [X] T001 Propose the Ukrainian and Polish word for "Fold" (a private space with its own key, not a plain folder) and complete the placeholder cells in `specs/004-ukrainian-polish-languages/contracts/glossary.md`; the native reviewers confirm it later (SC-007); a later replacement is a one-time rename of that term across both catalogues
- [X] T002 Register the languages in `apps/web/src/ui/i18n/i18n.ts`: add `uk: 'ltr'` and `pl: 'ltr'` to `LOCALES`, export `LANGUAGE_NAMES = { en: 'English', uk: 'Українська', pl: 'Polski' }`, and export `SELECTABLE_LOCALES = ['en', 'uk', 'pl']` (excludes `ar` and `en-XA`)
- [X] T003 [P] Create empty `apps/web/src/ui/i18n/messages/uk.json` and `apps/web/src/ui/i18n/messages/pl.json` containing `{}`

---

## Phase 2: Foundational (blocks every story)

- [X] T004 [P] Write the failing completeness test `apps/web/src/ui/i18n/catalogue-complete.test.ts` implementing rules 1–6 of `contracts/catalogue-contract.md` for `uk` and `pl` against the merged English catalogue (export it as `ENGLISH` from `i18n.ts`): same key set, ICU parses, same argument names and tags, plural arguments keep `plural` and include `other` plus every category `Intl.PluralRules` reports for the language, value differs from English unless on the allowlist (brand, currency codes, symbols). Failure output names language, key and rule number. Keep a `PENDING_LANGUAGES = ['uk', 'pl']` constant in the test that skips the real-file checks while the catalogues are being drafted, so CI stays green; T030 removes it
- [X] T005 [P] Extend `apps/web/src/ui/i18n/i18n.test.ts`: `resolveLocale(['pl-PL'])` → `pl`, `['uk-UA']` → `uk`, `['ru','pl']` → `pl` (unsupported skipped), `['de']` → `en`; `SUPPORTED_LOCALES` includes `uk` and `pl`; `directionOf('uk')` and `('pl')` are `ltr`
- [X] T006 Make `CATALOGS` in `apps/web/src/ui/i18n/i18n.ts` English-only plus an async `loadCatalogue(locale)` that returns the catalogue through a dynamic `import()` of `messages/uk.json` / `messages/pl.json` (separate chunks); unknown locales resolve to `{}`
- [X] T007 Update `apps/web/src/ui/i18n/I18nProvider.tsx` to load the catalogue for the resolved locale, render English until it arrives, then swap the translator; keep `<html lang dir>` in step; expose `locale`, `dir`, `t`. Only `lang`/`dir` change with the language; the page title stays the brand "Cashfold" (FR-008)
- [X] T008 [P] Move English-only error text so that `uk`/`pl` can carry the same keys: confirm `error.*` keys in `apps/web/src/ui/errors/catalogue.ts` (`MESSAGES_EN`) are part of `ENGLISH` and covered by T004; add a test in `apps/web/src/ui/errors/catalogue.test.ts` that every `ERROR_KINDS` entry has an `error.<Kind>` key
- [X] T009 Verify lazy chunks are offline-ready: build the web app, confirm the `uk`/`pl` chunk files appear in the service-worker precache manifest (`apps/web/src/sw/`), add an assertion to `apps/web/src/sw/core.test.ts` or the build check script if the manifest builder can skip dynamic chunks, and run `pnpm check:bundle` to confirm the budget holds

**Checkpoint**: T004 is red (catalogues empty) and everything else builds.

---

## Phase 3: User Story 1 — Use the whole app in Ukrainian or Polish (P1) 🎯 MVP

**Goal**: Every screen, message, error, date, number and plural is correct in `uk` and `pl` when the browser asks for it.

**Independent test**: Set the browser language to `uk`, then `pl`; walk every route; no English remains; counts use the right plural form; `1 234,56` and `1234.56` are accepted.

### Tests first

- [X] T010 [P] [US1] Add failing tests to `apps/web/src/ui/ledger/format.test.ts` for the amount normaliser: with `pl` and `uk`, `1 234,56` (space), `1 234,56` (no-break space U+00A0), `1 234,56` (narrow no-break U+202F) and `1234.56` all parse to `123456n` for a 2-decimal currency; `1.234,56` is rejected; `90071992547409.93` parses to `9007199254740993n`; en behaviour unchanged (`1,234.56`)
- [X] T011 [P] [US1] Add `apps/web/src/ui/i18n/plural.test.ts`: for `uk` and `pl`, a count-message from the real catalogue (use `schedules.inbox.banner`) renders the correct form for 0, 1, 2, 5, 12, 22 and 100 (SC-003)
- [X] T012 [P] [US1] Add `apps/web/src/ui/ledger/dates.test.ts` cases: `formatDate` and `formatDateTime` for `uk` and `pl` produce the locale's month names and keep Latin digits

### Implementation

- [X] T013 [US1] Implement `normalizeAmountText(text, locale)` in `apps/web/src/ui/ledger/format.ts` and call it inside `parseMoney` before `parseAmountText`: treat any whitespace (space, U+00A0, U+202F) as the locale's group separator when that separator is whitespace; accept `.` as decimal only when the locale's decimal is `,` and its group is not `.` and the text has no `,`. `core` stays unchanged and no floating point is introduced
- [X] T014 [US1] Write failing tests first: in `packages/core/src/ledger/domain/default-categories.test.ts` and `packages/core/src/ledger/application/category-commands.test.ts`, prove that `defaultCategories(fold, names)` and `seedDefaultCategories({ fold, names })` give the same ids and keys as without `names`, use a given name for a key present in `names`, and fall back to the English name for a missing key
- [X] T015 [US1] Starter names, core side: add an optional `names?: Readonly<Record<string, string>>` input to `seedDefaultCategories` in `packages/core/src/ledger/application/category-commands.ts` and to `defaultCategories(fold, names?)` in `packages/core/src/ledger/domain/default-categories.ts`; ids and keys stay derived from the English names so devices converge on the same records (two devices in different languages create the same records; per-field merge keeps one name); no text or locale enters `core`
- [X] T016 [P] [US1] Add the starter keys to `apps/web/src/ui/i18n/messages/en.json`: `starter.fold.personal` ("Personal") and one `starter.category.<key>` per entry of `ROOTS` in `default-categories.ts` (12 roots plus their children, keyed as `<root.key>.<slug(child)>`)
- [X] T017 [US1] Starter names, app side: in `apps/web/src/worker/app-handlers.ts` (`seedCategories`, `createAccount`, and the second seeding call near line 504) accept the category-name map and the personal-Fold name from the caller and pass them through; in `apps/web/src/ui/auth/SignUpForm.tsx` and the fold-creation UI, send `t('starter.fold.personal')` as `foldName` and the map built from `starter.category.<key>` messages (FR-015)
- [X] T018 [P] [US1] Make the emergency kit follow the language: change `buildEmergencyKitHtml` in `apps/web/src/ui/emergency-kit/kit.ts` to take `{ t, locale, dir }`, replace the literal English strings and `<html lang="en" dir="ltr">`, add the keys to `en.json`, and update `apps/web/src/ui/emergency-kit/kit.test.ts` (a `pl` kit has `lang="pl"` and no English labels)
- [X] T019 [P] [US1] Render name-ordered lists with `Intl.Collator(locale)` in the UI: audit screens that list payees, tags and category pickers (`apps/web/src/ui/ledger/`, `apps/web/src/ui/transactions/`) and re-order only lists the person did not order themselves; leave `core` queries unchanged; make any text search over names compare with `Intl.Collator(locale, { sensitivity: 'base' })` so `l` finds `ł` and `i` finds `ї`; add tests with `Ł`, `Ż`, `Ї`, `Є` names asserting alphabetical placement and the search matches for `pl` and `uk`
- [X] T020 [P] [US1] Audit other `Intl`/`toLocale*` users for correct locale use: `apps/web/src/ui/settings/StorageSection.tsx`, `ui/ledger/AttachmentField.tsx`, `ui/sharing/InvitationsSection.tsx`, `ui/devices/DevicesScreen.tsx`, `ui/data/CsvImportPanel.tsx`; fix any that ignore `locale`
- [X] T021 [P] [US1] Add a test (placed in `packages/core/src/ledger/application/export-csv.test.ts`, where the export lives) that the CSV export column headers are byte-identical under `en`, `uk` and `pl`, so exports stay readable by other tools and by import
- [X] T022 [US1] Draft `uk.json` — first block, in this order, using the glossary: `app`, `skip`, `lock`, `loading`, `confirm`, `nav`, `shell`, `status`, `empty`, `field`, `filter`, `page`, `locale`, `gate`, `cover`, `crash`, `removed`, `hint`, `support`, `starter`, plus all `error.*` keys, with full plural forms (`one/few/many/other`)
- [X] T023 [US1] Draft `pl.json` — same first block as T022
- [X] T024 [US1] Draft `uk.json` — account and security block: `signup`, `unlock`, `recover`, `password`, `secretkey`, `email`, `quick`, `kit`, `account`, `adddevice`, `devices`
- [X] T025 [US1] Draft `pl.json` — same block as T024
- [X] T026 [US1] Draft `uk.json` — money block: `ledger` (428 keys; split the work by the second key segment), `overview`, `data`
- [X] T027 [US1] Draft `pl.json` — same block as T026
- [X] T028 [US1] Draft `uk.json` — planning and sharing block: `budgets`, `schedules`, `goals`, `plan`, `folds`, `sharing`, `sync`, `syncenable`, `attention`, `storage`, `settings`
- [X] T029 [US1] Draft `pl.json` — same block as T028
- [X] T030 [US1] Remove `PENDING_LANGUAGES` from `catalogue-complete.test.ts` and make T004, T010, T011, T012 and T019 pass; fix any placeholder, tag or plural errors the completeness test reports until `pnpm --filter @cashfold/web test` is green
- [X] T031 [US1] Add `e2e/pseudo-walk.spec.ts` and register it for the existing `pseudo` project (`testMatch` in `e2e/playwright.config.ts`, locale `en-XA`): sign up, visit every route and open the add sheet and one dialog, and fail on any visible text node that still has plain ASCII words of three or more letters after the pseudo transform (allowlist: the brand, currency codes, user-entered data); this finds hard-coded English that the key-parity check cannot see (FR-001, SC-001). Fix every literal it reports by moving it into the catalogues The picker itself is walked in T043 once it exists
- [X] T032 [US1] Write `e2e/language.spec.ts` (US1 part, Chromium): with browser locale `uk` and `pl`, the sign-up page shows translated headings; after sign-up the shell and each main route show no text from a fixed list of English strings (`Create account`, `Transactions`, `Settings`, `Lock`; the full sweep is T031); no sideways scroll at 320 px on each route; `expectNoA11yViolations()` in both languages; the personal Fold is named per FR-015; an amount `1 234,56` is saved and shown back as `1 234,56`

**Checkpoint**: US1 works with the browser language alone; this is the MVP.

---

## Phase 4: User Story 2 — Choose the language in the app (P2)

**Goal**: A person can pick English, Ukrainian or Polish, before or after sign-in; the choice persists and wins over the browser.

**Independent test**: English browser → choose Polski in the footer of the sign-up page → reload → still Polish; then pick Українська in Settings → reload → still Ukrainian; choose Automatic → follows the browser.

### Tests first

- [X] T033 [P] [US2] Add failing tests to `apps/web/src/ui/prefs/schema.test.ts` for `language`: default `'auto'`; `'pl'` kept; `'xx'`, a number and `null` fall back to `'auto'` without touching other fields; an old stored object with no `language` still parses; the reset action restores `'auto'`
- [X] T034 [P] [US2] Add failing tests to `apps/web/src/ui/i18n/i18n.test.ts` for `resolveLanguage(choice, browserLanguages)`: saved `uk` beats browser `pl`; `auto` follows the browser; `auto` with no match gives `en`

### Implementation

- [X] T035 [US2] Add `language: 'auto' | 'en' | 'uk' | 'pl'` (default `'auto'`) to `Prefs` and `DEFAULT_PREFS` in `apps/web/src/ui/prefs/schema.ts` with field-by-field validation; no version bump; keep the stored object under `MAX_PREFS_BYTES`
- [X] T036 [US2] Add `resolveLanguage(choice, browserLanguages)` to `apps/web/src/ui/i18n/i18n.ts` and use it in `I18nProvider.tsx`, reading the choice through `usePrefs` and exposing `setLanguage(choice)` that updates `prefsStore`; the switch keeps route and form state
- [X] T037 [P] [US2] Create `apps/web/src/ui/i18n/LanguagePicker.tsx` using the kit `Select` (`apps/web/src/ui/kit/select.tsx`): options `Automatic` (translated), `English`, `Українська`, `Polski`; translated accessible name; add the keys to `en.json`, `uk.json`, `pl.json`
- [X] T038 [US2] Add a Language fieldset to `apps/web/src/ui/settings/AppearanceSection.tsx` using `LanguagePicker`, and make the existing reset action also reset `language`
- [X] T039 [US2] Put the picker in the footer of the pre-sign-in pages: add a `footer` slot to `apps/web/src/ui/kit/auth-layout.tsx` and render `LanguagePicker` there from `PlainShell` in `apps/web/src/ui/shell/AppShell.tsx` (also fills the space left by the removed header)
- [X] T040 [P] [US2] Desktop: add `apps/desktop/src/main/menu-labels.ts` with `en`/`uk`/`pl` labels for the custom menu entries (`File`, `Edit`, `View`, `Window`, `<app> on GitHub`, `Release notes`, `Report a problem`); change `buildMenu` in `apps/desktop/src/main/menu.ts` to take a language; start from `app.getLocale()` in `apps/desktop/src/main/index.ts`; add tests in `apps/desktop/src/main/menu.test.ts`
- [X] T041 [US2] Desktop language channel: add one renderer→main message carrying exactly `en | uk | pl` in `apps/desktop/src/preload/` and `apps/desktop/src/main/index.ts`, validate against the enum and ignore anything else, rebuild the menu on change, and call it from `I18nProvider.tsx` when running in the desktop shell; add a test that an invalid value is ignored
- [X] T042 [P] [US2] Desktop start-up error dialog: in `apps/desktop/src/main/data-folder.ts` (`problemMessage`, which already built the dialog text; there is no `problem-message.ts`) (and its call in `apps/desktop/src/main/index.ts:38`), take the title and detail from the same `en`/`uk`/`pl` label file as the menu (`menu-labels.ts`), choosing the language from the operating system (`app.getPreferredSystemLanguages()`, fall back to `en`) because no window or saved choice exists yet; add tests in `apps/desktop/src/main/problem-message.test.ts`; verify at start-up on macOS, Windows and Linux that the preferred-language call works before the app is ready, and fall back to `en` if it returns nothing
- [X] T043 [US2] Extend `e2e/language.spec.ts` (US2 part): picker visible and operable on the sign-up page with an English browser; typed input in a form field survives a language switch; the choice persists across reload and beats a different browser language; `Automatic` follows the browser; the switch works with the browser set offline; `html[lang]` changes; the language is reachable in at most 3 interactions from the sign-up page and from Settings, and the new language is visible within 1 s of the last interaction (SC-002); and in the `en-XA` project the sign-up footer picker and Settings → Appearance → Language also contain no untransformed English text (completes T031)

**Checkpoint**: US1 and US2 both work.

---

## Phase 5: User Story 3 — Keep translations complete as the app grows (P3)

**Goal**: A gap or mismatch in a translation is caught before release.

**Independent test**: Add an English-only key, or break a placeholder in `pl.json`; the unit job fails and names it.

- [X] T044 [P] [US3] Add negative tests in `apps/web/src/ui/i18n/catalogue-complete.test.ts` using in-memory catalogues (not the real files): a missing key, an extra key, a renamed argument, a missing `other`, a missing `few`/`many` for a language that needs it, and a value identical to English each fail with the right rule number in the message
- [X] T045 [US3] Confirm the check runs in CI: find the unit-test job in `.github/workflows/` and make sure `apps/web/src/ui/i18n/catalogue-complete.test.ts` is included and blocks merge; add a short "Adding or changing a message" section to `docs/` (new file `docs/i18n.md`) stating the rules from `contracts/catalogue-contract.md`
- [X] T046 [P] [US3] Add a test that the English fallback is only a safety net: with a key deleted from a fake `uk` catalogue the translator returns the English text, never the key or an empty string

---

## Phase 6: Polish and cross-cutting

- [X] T047 [P] Fonts: add a render check (Playwright screenshot or computed `document.fonts.check`) that `Ґ ґ Є є І і Ї ї` and `Ą Ć Ę Ł Ń Ó Ś Ź Ż` use the bundled Ubuntu faces, in `e2e/language.spec.ts`
- [X] T048 [P] Long-text check: run the `ux-responsive` style overflow walk at 320 px and 1280 px under `uk` and `pl` for overview, transactions, accounts, plan, settings, devices, and the add-transaction sheet; fix clipped buttons, sidebar labels and table headers found
- [X] T049 [P] Static metadata: make `description` in `apps/web/src/app/layout.tsx` and `apps/web/public/manifest.webmanifest` language-neutral (brand name only) as recorded in FR-009 and `research.md`
- [X] T050 [P] Update `docs/` and the README: supported languages, how to add one (catalogue, `LOCALES`, picker name, desktop labels), and the review process; add an ADR `docs/adr/0011-languages-and-catalogue-loading.md` recording lazy catalogue loading and the device-local language preference
- [X] T051 Run the whole quickstart in `specs/004-ukrainian-polish-languages/quickstart.md`, record the result, and run `pnpm lint`, type-check, unit tests, `pnpm check:bundle` and the Playwright suites (including the `rtl` and `pseudo` projects) to confirm nothing regressed (FR-014)
- [X] T052 Open the native-speaker review: list the glossary and the draft screens for one Ukrainian and one Polish reviewer, and track their issues as follow-up work for the release after the first (SC-007)

---

## Dependencies and order

- Phase 1 → Phase 2 → Phases 3–5 → Phase 6.
- **US1** needs Phase 2 only. **US2** needs Phase 2 and shares files with US1 (`en.json`, `uk.json`, `pl.json`, `I18nProvider.tsx`, `i18n.test.ts`), so run US2's code tasks (T033–T036, T038–T042) after T007, and add the picker keys (T037) only after the matching draft blocks T022–T029 are merged, or keep them in a separate commit to avoid conflicts. **US3** needs T004 and can run any time after Phase 2.
- Within US1: T010–T012 before T013; T014 before T015; T015 and T016 before T017; T016 and T018 (both add English keys) before the drafts T022/T023; the draft blocks T022–T029 can run in parallel pairs (uk and pl are separate files); T030 after all drafts; T031 and T032 last.
- Within US2: T033–T034 before T035–T036; T037 before T038–T039; T040 before T041.

## Parallel examples

- After Phase 2: T010, T011, T012 together; T018, T019, T020, T021 together; the `uk` and `pl` drafts of each block (T022/T023, T024/T025, T026/T027, T028/T029) together.
- US2: T033, T034 and T037 together; T040 and T042 with T038/T039.
- Polish: T047, T048, T049, T050 together.

## Implementation strategy

1. **MVP = Phases 1, 2 and 3.** Browser-language detection with complete Ukrainian and Polish text, exact amount input and correct plurals, starter names and emergency kit. This alone satisfies the main purpose.
2. Add US2 (picker, persistence, desktop menu) and ship together with MVP or right after; the spec offers the languages from the first release.
3. US3 and Polish harden the result; T052 starts the review that SC-007 asks for.

## Notes

- `packages/core` gets one small, optional-input change (T014). The plan said core would not change; this is the only exception, it is backward compatible, and it adds no locale or text to `core`.
- Decision (analysis D2): commits and pull requests for this feature follow the constitution's workflow rule, with no AI-attribution or co-author lines.
