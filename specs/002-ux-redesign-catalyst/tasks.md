---
description: "Task list for Calm, Task-Focused UX and Design-System UI"
---

# Tasks: Calm, Task-Focused UX and Design-System UI

**Input**: Design documents from `/specs/002-ux-redesign-catalyst/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (`routes.md`, `ui-kit.md`, `form-fields.md`, `screen-map.md`, `preferences.schema.json`), quickstart.md; governed by `.specify/memory/constitution.md`. Reference study: `docs/reference/reference-app/` (interaction ideas only).

**Tests**: REQUIRED. The constitution requires a Playwright end-to-end test for each P1 and P2 story, accessibility checks (axe, WCAG 2.2 AA) and a plaintext-leak scan; helpers with logic (`visibleFields`, preferences parsing, route table, period resolution, filter/URL round-trip, day grouping, status maths) are developed test-first. Within each story, test tasks come first and MUST fail before the matching implementation. Every Playwright spec also runs once under the `rtl` project.

**Organization**: Tasks are grouped by user story (spec priorities P1, P2, P3) so each story can be implemented and tested independently once the Foundational phase is done.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: User story label (US1…US9). Setup, Foundational and Polish tasks have none.
- `Depends on Txxx` marks an explicit dependency beyond phase order.
- `Refs:` lists the spec requirements (FR-/SC-), research items or constitution principles each task serves.

## Path Conventions

`apps/web/src/ui/` (screens and components), `apps/web/src/app/` (routes, tokens), `apps/web/scripts/`, `scripts/`, `eslint-rules/`, `e2e/`, `docs/`. **No task touches** `packages/core`, `packages/crypto`, `packages/protocol`, `apps/server` or the Core Worker's commands and queries (FR-048): screens keep their existing `ledger.*`, `settings.*`, `schedules.*`, `attachments.*` calls and payloads.

## Scope Note

The recommended first release candidate is Phases 1–5 (Setup, Foundational, US1–US3 = the P1 stories). Phases 6–9 are P2, Phases 10–11 are P3, Phase 12 finishes and removes the old interface. Per FR-054 the old and new interfaces never ship together. **Release strategy** (plan.md): every PR is small, single-concern and squash-merged into the long-lived protected integration branch `002-ux-redesign-catalyst`; `main` keeps the old interface until the finished branch is released once (gate T002). Intermediate merges keep the app working on that branch (the Foundational skeleton re-wraps existing screens in the new shell), and the old screens are deleted by the end of Phase 12.

---

## Phase 1: Setup (Gates, Baseline, Dependencies)

**Purpose**: Decisions and measurements that must exist before any UI changes. Nothing here changes behaviour.

- [X] T001 **Gate — Tailwind Plus licence confirmation.** The project owner confirms in writing (email to `support@tailwindcss.com`) that (a) their licence covers every committer and (b) isolating the Catalyst-derived files in `apps/web/src/ui/kit/` with their own licence notice is acceptable in this AGPL-3.0 repository. Record the reply and the date under R-UX-01 in `specs/002-ux-redesign-catalyst/research.md`. If refused, switch every kit task to the independent-authoring fallback described in R-UX-01 and note it here. This task cannot be done by an engineer alone; no kit file may be committed before it is closed — Refs: R-UX-01; plan WS0-1
- [X] T002 **Gate — release rollup sign-off.** Work lands through small, single-concern PRs that are squash-merged into the protected long-lived integration branch `002-ux-redesign-catalyst` (same review and CI requirements as `main`; see plan.md Release strategy). Releasing that branch to `main` is a rollup PR containing no new changes. The constitution requires small PRs, so the owner must explicitly accept the rollup as a release step (or choose to amend the constitution in a separate change). Record the decision in `specs/002-ux-redesign-catalyst/plan.md` (Release strategy) now, and copy it into `docs/adr/0008-catalyst-ui-kit.md` in the docs task; no feature PR is merged to the integration branch before this is decided — Refs: Constitution Workflow; FR-054; plan Release strategy
- [X] T003 [P] Write `e2e/bench/ui-baseline.spec.ts`: for Dashboard, Transactions, the add form (open from Transactions), Accounts, Budgets, Goals, Schedules, Settings, run at 390×844 and 1280×800 and record (a) the count of visible interactive elements (`a[href], button, input, select, textarea, summary, [role=button], [role=tab], [role=menuitem]`) on first load, (b) the number of fields in the add form, (c) the number of primary navigation entries. Write the result to `specs/002-ux-redesign-catalyst/baseline.json` and commit it BEFORE any UI change — Refs: SC-002, SC-003, SC-005; quickstart §0
- [X] T004 [P] Extend `e2e/fixtures/index.ts` with an auto-use fixture that listens for `securitypolicyviolation` events and Trusted Types violations on every page and fails the test with the offending directive and URL. Add `e2e/ux-csp.spec.ts` that signs up, adds a transaction and visits every route, asserting zero violations. Run against the current UI first (must pass), so any later regression is attributable — Refs: FR-049; R-UX-03
- [X] T005 In `apps/web/package.json` add exact-pinned `@headlessui/react` (2.2.x), `clsx`, `@heroicons/react` as dependencies and `@fontsource/ubuntu` as a devDependency; do NOT add `motion`. Run `pnpm install` to update `pnpm-lock.yaml`, then `pnpm audit`, `pnpm check:licenses` and the SBOM generation; attach the output to the PR — Refs: FR-049, FR-052; Constitution VIII; R-UX-02
- [X] T006 [P] Update `scripts/check-licenses.mjs` so the `@fontsource/ubuntu` devDependency and the shipped Ubuntu files pass via a documented asset exception (reason: UFL-1.0, unmodified, shipped with licence text), not by widening `ALLOWED`. Extend `scripts/gen-third-party-notices.mjs` and `THIRD_PARTY_NOTICES.md` to list Ubuntu (UFL-1.0), Headless UI, clsx, Heroicons and the vendored Catalyst files (Tailwind Plus License, isolated in `apps/web/src/ui/kit/`) — Refs: R-UX-01, R-UX-07
- [X] T007 [P] Test-first: add `eslint-rules/ui-kit-boundaries.test.js` then `eslint-rules/ui-kit-boundaries.js` with three rules — `no-headless-outside-kit` (importing `@headlessui/react` outside `apps/web/src/ui/kit/`), `no-raw-controls` (`<button>`, `<input>`, `<select>`, `<textarea>` in `apps/web/src/ui/**` outside `ui/kit/`, with an allow-list for `type="file"` and hidden inputs), and `no-name-on-headless` (a `name` prop on kit `Switch`, `Checkbox`, `Radio`, `Listbox`, `Combobox`). Wire them in `eslint.config.js` as warnings for the migration and switch to errors in T111 — Refs: R-UX-03; ui-kit.md §6
- [X] T008 [P] Test-first in `scripts/ci-gates.test.ts`, then extend `apps/web/scripts/harden-html.mjs`: (a) fail the build when any prerendered `out/**/*.html` contains a `style=` attribute, (b) include the theme bootstrap inline script (added in T015) in the per-page CSP hashes, (c) assert in the test that every page's CSP meta contains that script's hash. Before enabling (a), run the check against the CURRENT build and record the result in the PR: if today's export already contains `style=` attributes, fix or allow-list them explicitly first, so the gate is meaningful — Refs: R-UX-03, R-UX-05; FR-049
- [X] T009 [P] In `scripts/check-bundle-size.mjs` print the share of the initial and lazy chunks that comes from `ui/kit` and Headless UI (by module path in the chunk source map or by a build-time marker), keeping the current budgets unchanged until T114 — Refs: FR-052; R-UX-02
---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Design tokens, theme, font, preferences, field registry, the kit, and a route/shell skeleton that every story builds on. **No user story starts before the Checkpoint.**

**⚠️ CRITICAL**: T001 (licence) must be closed before the kit tasks in this phase begin.

### Tokens, theme, font

- [X] T010 Test-first: extend `apps/web/src/ui/tokens.test.ts` to read the new `[data-theme="light"]` and `[data-theme="dark"]` blocks and assert WCAG 2.2 AA pairs: text 4.5:1 for `text/bg`, `text-muted/bg`, `accent-text/bg`, `on-primary/primary`, `danger/bg`, `success/bg`, `warning/bg`; non-text 3:1 for `focus/bg` and `border-strong/bg`; with the values from `contracts/ui-kit.md` §5 (light primary emerald-700 `#047857` with white = 5.48:1; dark primary emerald-500 `#10b981` with zinc-950 = 7.84:1). The test must fail before T011 — Refs: FR-041, FR-042; R-UX-06
- [X] T011 Rewrite `apps/web/src/app/tokens.css`: semantic tokens per `contracts/ui-kit.md` §5 keyed by `[data-theme="light"]` / `[data-theme="dark"]` (with `:root` defaulting to light), `color-scheme` per theme, `--font-sans: Ubuntu, system-ui, sans-serif`, keep `prefers-reduced-motion` and `forced-colors` blocks. In `apps/web/src/app/globals.css` add `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));`, base typography, and a `tabular-nums` utility class for amounts. Keep physical-direction CSS out (see `ui/logical-layout.test.ts`) — depends on T010 — Refs: FR-040, FR-041; R-UX-05
- [X] T012 [P] Create `apps/web/scripts/copy-fonts.mjs` that copies the unmodified `woff2` files for weights 400, 500, 700 and subsets `latin`, `latin-ext`, `cyrillic`, `cyrillic-ext`, `greek` from `node_modules/@fontsource/ubuntu/files/` into `apps/web/public/fonts/`, plus the Ubuntu Font Licence text as `apps/web/public/fonts/UFL.txt`, and generates `apps/web/src/app/fonts.css` with one `@font-face` per file using `unicode-range` and `font-display: swap`. Wire it into the `predev`, `prebuild` and `pretest:browser` scripts in `apps/web/package.json`, and git-ignore the generated files except `UFL.txt` — Refs: FR-040, FR-049; R-UX-07
- [X] T013 Preload only Latin 400 and 500 in `apps/web/src/app/layout.tsx` via `<link rel="preload" as="font" crossOrigin="anonymous">`, import `fonts.css` from `globals.css`, and precache `/fonts/*` in `apps/web/scripts/build-sw.mjs` so offline reload shows Ubuntu. Add a check to `scripts/check-bundle-size.mjs` that prints total font bytes shipped — depends on T012 — Refs: FR-049, FR-050
- [X] T014 Test-first: `apps/web/src/ui/theme/resolve-theme.test.ts` for a pure `resolveTheme(choice, systemDark)` and for parsing the stored choice defensively (invalid → `system`; storage throws → `system`). Then implement `apps/web/src/ui/theme/resolve-theme.ts` — Refs: FR-041
- [X] T015 Create the pre-paint bootstrap: `apps/web/src/ui/theme/bootstrap.ts` exporting the script source as a string (reads `cashfold.ui` from `localStorage` inside try/catch, falls back to `system`, sets `document.documentElement.dataset.theme` and `style.colorScheme` — no inline `style` attributes in markup). Inject it as a synchronous inline `<script>` in `<head>` in `apps/web/src/app/layout.tsx` — depends on T014 — Refs: FR-041; R-UX-05
- [X] T016 Implement `apps/web/src/ui/theme/ThemeProvider.tsx` exposing `{ choice, resolved, setChoice }`, subscribing to `matchMedia('(prefers-color-scheme: dark)')` while `choice === 'system'`, writing through `ui/prefs`, and mount it in `apps/web/src/app/providers.tsx` — depends on T015 and T019 — Refs: FR-041
### Interface preferences and field registry

- [X] T017 [P] Test-first: `apps/web/src/ui/prefs/schema.test.ts` — parse/validate against `contracts/preferences.schema.json` semantics: unknown keys dropped; invalid enum/boolean/date values fall back per field; `v` higher than 1 → defaults and no overwrite; serialised size ≤ 4 KiB (oldest `recents` entries dropped first); `recents.categories` capped at 8 per Fold; `hints.dismissed` ≤ 32; custom period requires `from <= to` — Refs: data-model §1; FR-051
- [X] T018 Implement `apps/web/src/ui/prefs/schema.ts` (types and `parsePrefs`/`serializePrefs`) and `apps/web/src/ui/prefs/migrate.ts` (`migrate(prev)` with a fixture for `v1`) to satisfy T017 — Refs: data-model §1
- [X] T019 Implement `apps/web/src/ui/prefs/store.ts` (read once, write on change inside try/catch, `storage` event listener, in-memory fallback when `localStorage` throws) and `apps/web/src/ui/prefs/usePrefs.ts` (`useSyncExternalStore` hook with selector). No call into the Core Worker, sync or export — depends on T018 — Refs: FR-051; R-UX-08
- [X] T020 [P] Extend `e2e/leak-scan.self-test.spec.ts` and `e2e/fixtures/leak-scan.ts` so the scan allows only the `cashfold.ui` `localStorage` key, validates its value against `contracts/preferences.schema.json`, and fails if it contains an amount, name, email or note string seeded by the test — Refs: FR-051; Constitution I
- [X] T021 [P] Test-first: `apps/web/src/ui/prefs/visible-fields.test.ts` for `visibleFields(form, prefs, values, mode)` per `data-model.md` §2 — essential always visible; optional visible when `prefs.optionalFields[id]` or `defaultVisible`; hidden-but-filled optional field is visible in edit mode and opens the group; technical fields only in Advanced; and a registry test that every form's default view (essential + default-visible optional fields, not counting the type switch of forms that have one) has at most 6 fields and that every field id in `contracts/form-fields.md` exists exactly once
- [X] T022 Implement the field registry `apps/web/src/ui/prefs/fields.ts` from `contracts/form-fields.md` (ids, class E/O/T, `defaultVisible`, `appliesTo`, `hasValue`) and `apps/web/src/ui/prefs/visible-fields.ts` to satisfy T021 — Refs: FR-009, FR-020, FR-021
### Component kit (`apps/web/src/ui/kit/`) — after T001

- [X] T023 Create `apps/web/src/ui/kit/LICENSE-TAILWIND-PLUS.md` (the licence text from the purchased kit plus a note that files in this directory are not covered by the repository's AGPL grant), `apps/web/src/ui/kit/index.ts` (barrel, initially empty) and `apps/web/src/ui/kit/icons.ts` (named re-exports of the Heroicons the plan uses: Home, ArrowsRightLeft, Banknotes, Flag, Cog6Tooth, Plus, Lock, MagnifyingGlass, FunnelIcon, EllipsisHorizontal, ChevronDown, XMark, Check, ExclamationTriangle, InformationCircle, ArrowPath, CloudArrowUp, Bars3) — depends on T001 — Refs: R-UX-01; ui-kit.md §1
- [X] T024 [P] Port `button`, `link`, `text`, `heading`, `divider`, `badge`, `avatar` from `/Users/pogulailo/Downloads/catalyst-ui-kit/typescript/` into `apps/web/src/ui/kit/` applying every rule in `contracts/ui-kit.md` §3: logical utilities only, the `primary` colour from tokens (not the kit's `emerald`), `link.tsx` built on Next.js `Link` keeping `Headless.DataInteractive`, header comment on each file. Export from the barrel — depends on T023, T011 — Refs: FR-039, FR-044; R-UX-04, R-UX-06
- [X] T025 [P] Port `input`, `textarea`, `select`, `fieldset` (Field, Label, Description, ErrorMessage, FieldGroup, Fieldset, Legend), `checkbox`, `radio`, `switch` into `apps/web/src/ui/kit/` per §3; the types must not accept a `name` prop on `Switch`, `Checkbox`, `Radio`; label above field, description below, error replacing description with `aria-invalid` and `aria-describedby` wiring (FR-010) — depends on T023 — Refs: FR-010, FR-039; R-UX-03
- [X] T026 [P] Port `dialog` with the `placement: 'center' | 'sheet'` extension (§3 item 7: bottom-anchored with rounded top corners below `sm`, centred from `sm`; `max-h-[100dvh]`; scrolling body; sticky footer), `alert` and `dropdown` into `apps/web/src/ui/kit/`; dialogs use CSS `data-closed` transitions only — depends on T023 — Refs: FR-007, FR-012, FR-039
- [X] T027 [P] Port `listbox` and `combobox` into `apps/web/src/ui/kit/` (no `name` prop; logical utilities replacing every `pl-/pr-/ml-/right-0/text-left`); add a `ComboboxCreate` wrapper that offers "Create ‘x’" for tags and payees — depends on T023 — Refs: FR-020; R-UX-02
- [X] T028 [P] Port `navbar`, `sidebar`, `sidebar-layout`, `stacked-layout`, `auth-layout` into `apps/web/src/ui/kit/` with `motion` removed: delete `LayoutGroup`/`motion.span` and render a plain `<span>` current-item marker with `motion-safe:transition-colors`; logical utilities throughout (`-ml-4`, `text-left`, `left-1/2` fixed) — depends on T023 — Refs: FR-003, FR-004; R-UX-02, R-UX-04
- [X] T029 [P] Port `table`, `description-list` and (only if the transaction list needs it) `pagination` into `apps/web/src/ui/kit/`; tables scroll inside their own container on narrow screens (FR-043) — depends on T023 — Refs: FR-043
- [X] T030 [P] Test-first: `apps/web/src/ui/kit/amount.test.tsx` — `Amount` renders `bigint` minor units with the locale's grouping, explicit minus sign and currency, `tabular-nums`, right-aligned in tables, and a text cue (sign or word) for gain/loss in addition to colour (FR-042). Then implement `apps/web/src/ui/kit/amount.tsx` (takes `minor: bigint`, `currency`, `locale`; no `number` in money paths — `eslint-rules/no-number-in-money.js` applies to `ui/**/*amount*`) — Refs: FR-042; Constitution VI
- [X] T031 [P] Author `apps/web/src/ui/kit/sheet.tsx` (responsive wrapper over the kit `Dialog` with `placement="sheet"`, `title`, `description`, `footer`, `size`; footer stays above the on-screen keyboard using `dvh` and `env(keyboard-inset-height)` with a sticky fallback) and `apps/web/src/ui/kit/disclosure.tsx` (Headless `Disclosure` with `summary` shown when collapsed, `defaultOpen`, `onOpenChange`) — Refs: FR-007, FR-017, FR-020
- [X] T032 [P] Author `apps/web/src/ui/kit/tabs.tsx` (Headless `TabGroup` styled as the kit's navbar-style segmented control; `value`/`onChange`, `items`, accessible label), `apps/web/src/ui/kit/stat.tsx`, `apps/web/src/ui/kit/progress.tsx` (`role="progressbar"` plus visible status text and tone), `apps/web/src/ui/kit/chip.tsx` (removable, `removeLabel`), `apps/web/src/ui/kit/empty-state.tsx` (icon, title, body, action) per `contracts/ui-kit.md` §4. All strings via props
- [X] T033 [P] Author `apps/web/src/ui/kit/status-message.tsx` and `apps/web/src/ui/shell/StatusProvider.tsx`: a brief, non-blocking confirmation (e.g. "Transaction saved", "Account archived") rendered as a polite `role="status"` live region, auto-dismissing after about 4 seconds, dismissible with a button, no focus steal, respecting reduced motion, with a `useStatus().notify(messageKey, params)` hook. Test-first: `apps/web/src/ui/shell/StatusProvider.test.tsx` (queues messages, announces once, dismisses). Mount the provider in `apps/web/src/ui/shell/AppShell.tsx` when T041 exists. No undo action is offered (spec clarification Q1) — Refs: FR-013
- [X] T034 Update `apps/web/src/ui/kit/index.ts` to export every ported and authored component; run `pnpm lint` and confirm `apps/web/src/ui/logical-layout.test.ts` passes over `ui/kit/` with NO exemption; confirm the build's `check-bundle-size` output lists the kit share — depends on T024, T025, T026, T027, T028, T029, T030, T031, T032, T033
- [X] T035 Create a kit gallery as a Vitest browser story set `apps/web/src/ui/kit/kit.browser.test.tsx` rendering every kit component and variant in both themes; run axe (`wcag2a/aa/21aa/22aa`) on each and a keyboard-operability check for dialog, dropdown, listbox, combobox, tabs and disclosure (focus trap, Escape, restore focus); wire into `apps/web/vitest.browser.config.ts` — depends on T034 — Refs: FR-045; SC-006, SC-007
### Strings, routes and shell skeleton

- [X] T036 Add the new message keys to `apps/web/src/ui/i18n/messages/en.json` (nav: `nav.overview`, `nav.plan`; settings groups and descriptions; empty states; first-run checklist; hints; filter chips; add-sheet labels `ledger.add.more`, `ledger.add.title`; status texts for progress; shell labels `shell.foldSwitcher`, `shell.lock`, `shell.menu`, `shell.add`) and keep every existing key until T111. Run `apps/web/src/ui/ledger/messages.test.ts` and `apps/web/src/ui/i18n/i18n.test.ts` — all strings live in the catalogue, none inside kit components — Refs: FR-046
- [X] T037 [P] Test-first: `apps/web/src/ui/i18n/pseudo.test.ts`, then implement `apps/web/src/ui/i18n/pseudo.ts` and register it in `apps/web/src/ui/i18n/i18n.ts` as locale `en-XA` (test-only, never offered to people): transforms every English message into an accented string about 40 % longer, preserving ICU placeholders and plural syntax, and wrapping the text in markers so clipping is visible. Add a Playwright project `pseudo` (Desktop Chrome, `locale: 'en-XA'`) to `e2e/playwright.config.ts` that runs only the responsive spec. `intl-messageformat` must still parse every transformed message (the test iterates the whole catalogue) — Refs: FR-046
- [X] T038 [P] Test-first: `apps/web/src/ui/shell/routes.test.ts` — the route table in `contracts/routes.md` (5 primary entries in order, settings groups, query parameters, redirect table). Assertions: exactly 5 primary sections; every redirect target exists in the table; no redirect source is also a primary route; every settings group has a route and a description key. Then implement `apps/web/src/ui/shell/routes.ts` (typed table, `matchSection(pathname)`) — Refs: FR-001, FR-002, FR-006
- [X] T039 Create the new routes as thin pages that wrap the EXISTING screens unchanged (so the app keeps working): `apps/web/src/app/overview/page.tsx` (wraps `DashboardScreen`), `apps/web/src/app/plan/page.tsx` (client component reading `?view=` and rendering the existing Budgets/Goals/Schedules screens), and the `/settings/*` pages with this interim mapping until T095…T101 split and restyle them: `profile` renders the whole current `SettingsScreen`; `sync` renders `DevicesScreen`; `data` renders `DataScreen`; `folds` renders `FoldsScreen`; `categories` renders `CategoriesScreen`; `appearance` and `advanced` render a minimal placeholder page (one `<h1>`, a short sentence, a link back to `/settings/`) that US1 (T053) and US7 (T100) replace; `/settings/` renders a plain list of the seven groups. Depends on T038 — Refs: FR-002
- [X] T040 Replace `apps/web/src/app/{dashboard,transfers,budgets,goals,schedules,categories,data,devices,folds}/page.tsx` with redirect stubs: a client component calling `router.replace(target + preserved query)` and a `<noscript>` link, per the table in `contracts/routes.md` §5; `/` redirects an unlocked person to `/overview/`. Depends on T039 — Refs: FR-006; R-UX-09
- [X] T041 Rewrite `apps/web/src/ui/shell/AppShell.tsx` on the kit `SidebarLayout`: five entries from `routes.ts` with `aria-current="page"`, `nav[aria-label="Main"]` kept, skip link first, one `<main id="main">`, existing banners (`removed`, `storage-full`) kept with their `data-testid`, `StorageNotice` and `PrivacyCover` mounted, a header **Add** button (opens the add flow once T047 exists) and the existing lock button. Keep every `data-testid` used by e2e. Depends on T038, T028 — Refs: FR-001, FR-003, FR-004, FR-007
- [X] T042 Test-first: `apps/web/src/ui/shell/OverlayHost.test.tsx`, then implement `apps/web/src/ui/shell/OverlayHost.tsx`: tracks open overlays; when `core.covered` is true sets `inert` and `aria-hidden` on `#headlessui-portal-root` while leaving overlay React state mounted; on lock closes all overlays and discards their state without an unsaved-changes prompt (R-UX-10). Mount in `AppShell` — Refs: R-UX-10; spec edge cases
- [X] T043 Update the existing e2e specs for the new IA without changing their assertions' intent: `e2e/a11y.spec.ts` (`SCREENS` list and `go()` to the five entries plus sub-routes), `e2e/shell.spec.ts` (routes list, brand link still first at inline start), `e2e/offline-reload.spec.ts`, `e2e/us1-account.spec.ts`, `e2e/us2-ledger.spec.ts`, `e2e/us3-transfers.spec.ts`, `e2e/us5-budgets.spec.ts`, `e2e/us6-schedules.spec.ts`, `e2e/us7-sharing.spec.ts`, `e2e/us8-goals.spec.ts`, `e2e/us9-recovery.spec.ts`, `e2e/us4-sync.spec.ts`, `e2e/us1-quick-unlock.spec.ts`, `e2e/multitab.spec.ts` — navigate via the new labels or direct URLs; run the full suite on chromium and `rtl` and confirm it is green with the skeleton shell. Depends on T040, T041 — Refs: FR-053
**Checkpoint**: tokens, theme, font, prefs, registry, kit and a working (restyled-shell) skeleton exist; all e2e specs pass. User stories can now proceed — US1, US2 and US3 in parallel by different people if wanted; US4–US9 after their listed dependencies.

---

## Phase 3: User Story 1 — Record a transaction in seconds (Priority: P1) 🎯 MVP

**Goal**: From any screen, add a basic expense in ≤ 4 interactions; all other fields behind "More details"; remembered preferences; foreign-currency rate prompt inline.

**Independent Test**: With one account and a few categories, open Add, type an amount, pick a category, Save: ≤ 4 interactions, ≤ 5 default fields, no scrolling at 390×844, entry appears in the list (quickstart S1–S4).

### Tests for User Story 1 (write first; must fail)

- [X] T044 [P] [US1] e2e `e2e/ux-add.spec.ts`: (S1) sign up → create account → open Add from Overview, Accounts and Settings → amount focused, ≤ 5 visible fields, "More details" collapsed, type `12.50`, pick category, Save in ≤ 4 interactions without scrolling at 390×844; (S2) expand More details, add payee + tag, save, reopen — More details still expanded and last account preselected; (S3) edit an entry that has a note while `tx.note` is off by default — note visible; (S4b) switch to Transfer in the same sheet, pick two accounts with different currencies, see the received-amount field, save, and see the transfer in the list with a Transfer badge; (S4) amount in an account currency lacking a rate → inline rate prompt in the same sheet → after entry the save completes with other values intact; axe clean in both themes; runs under `rtl` — Refs: FR-007, FR-020–FR-022; SC-001, SC-002; quickstart S1–S4
- [X] T045 [P] [US1] Unit tests `apps/web/src/ui/transactions/recents.test.ts` (pure helpers `pickDefaultAccount(prefs, foldId, accounts)` and `orderCategories(recents, categories)`: last-used account per Fold, recent categories first then parents with children, ids that no longer exist are ignored and pruned) and `apps/web/src/ui/transactions/dirty.test.ts` (`isDirty(initial, current)` — no prompt when unchanged) — Refs: FR-011, FR-022
### Implementation for User Story 1

- [X] T046 [US1] Implement `apps/web/src/ui/transactions/recents.ts` and `dirty.ts` to satisfy T045; writing recents calls `ui/prefs` only (ids only, cap 8 categories per Fold) — Refs: FR-022; data-model §1
- [X] T047 [US1] Create `apps/web/src/ui/transactions/AddSheetHost.tsx` mounted by `AppShell`: opens the sheet when the URL has `?new=expense|income|transfer` (adds/removes the parameter so Back closes it) or when the shell Add button / `Add` entries in account row menus fire `openAdd({ type, accountId })`; renders the `Sheet` from the kit; closes on lock via T042. Depends on T041, T042 — Refs: FR-007; R-UX-09
- [X] T048 [US1] Create `apps/web/src/ui/transactions/AddSheet.tsx` replacing the layout of `apps/web/src/ui/ledger/TransactionForm.tsx` but **calling the same `ledger.addTransaction` / `ledger.updateTransaction` commands with the same payloads** (FR-048). Default view: `tx.kind` (segmented Expense/Income), `tx.amount` (focused, `inputMode="decimal"`, uses `ledger.parse` — single number only, no expressions), `tx.account` (defaults via `pickDefaultAccount`), `tx.category` (Combobox, recents first, `optgroup` parent › child), `tx.when` (`datetime-local`, defaults now). Everything else inside a kit `Disclosure` titled "More details" whose open state is `prefs.moreDetailsOpen`; field visibility from `visibleFields()`; dirty-check on close; busy state prevents double submit; Save stays in the sticky footer; a successful save announces "Transaction saved" through `useStatus()` (FR-013). Depends on T046, T022, T031, T033, T027, T047 — Refs: FR-008, FR-009, FR-011, FR-019, FR-020, FR-022
- [X] T049 [P] [US1] Build the "More details" fields as kit components in `apps/web/src/ui/transactions/fields/`: `PayeeField.tsx` (Combobox over `basics.payees`, creates via the existing `ledger.createPayee` path through `labelId`), `TagsField.tsx` (chips + `ComboboxCreate`, max `MAX_TAGS` with the existing error text), `NoteField.tsx` (`MAX_NOTE`), `StatusField.tsx` (only transitions allowed by `canTransition`), `RefundPinFields.tsx` (refund only for income), `PlaceField.tsx` (name + "Use my location" + clear; latitude/longitude inside an "Exact coordinates" `Disclosure`, using the same `parseDegrees`/`degreesFromDevice` helpers and denied-permission message), and restyle `apps/web/src/ui/ledger/AttachmentField.tsx` with kit components (behaviour unchanged). Each field has a `fieldId` prop matching the registry — Refs: FR-020; contracts/form-fields.md
- [X] T050 [US1] Add the transfer mode to the sheet in `apps/web/src/ui/transactions/TransferMode.tsx`, selected by the type switch (`?new=transfer` opens it): fields `xf.from`, `xf.to`, `xf.amount`, `xf.received` (only when the two accounts' currencies differ), `xf.when` (default view: five fields, six when currencies differ), optional `xf.note`, technical `xf.rate`. **Move, do not rewrite,** the logic of `apps/web/src/ui/ledger/transfer/TransferForm.tsx` and `suggest.ts` (same transfer command and payload, same suggested received amount and rate behaviour, `rate_required` handled by the inline prompt in T051); keep the existing unit tests `apps/web/src/ui/ledger/transfer/suggest.test.ts` green after the move. Depends on T048 — Refs: FR-023; spec US1
- [X] T051 [US1] Move the inline rate prompt into the sheet: when the command returns `rate_required`, switch the sheet body to the existing rate form (restyled in `apps/web/src/ui/transactions/RatePrompt.tsx`, same `ledger.setCustomRate` call and `parseRateText`), then resubmit with the user's other values preserved; Cancel returns to the form. Depends on T048 — Refs: spec US1 scenario 6
- [X] T052 [US1] Make the edit flow use the same sheet: `TransactionsScreen` row activation opens `AddSheet` in edit mode with `existing`; hidden optional fields that hold a value are shown and the group opens (`visibleFields` mode `edit`); `lastChanged` line kept as `data-testid="last-changed"`. Adjustments keep the fixed "Adjustment" label. Depends on T048, T049 — Refs: FR-021; spec edge case
- [X] T053 [US1] Add the optional-field toggles to Settings → Appearance in `apps/web/src/ui/settings/AppearanceSection.tsx`: one `Switch` per optional field of the transaction form (from the registry) with its description, bound to `prefs.optionalFields`, plus "Reset interface settings" (clears `cashfold.ui` after confirmation). Wire into `apps/web/src/app/settings/appearance/page.tsx`. Depends on T022, T019, T016 — Refs: FR-021, FR-035
- [X] T054 [US1] Run `e2e/ux-add.spec.ts` (including the status message announced after save) plus the updated `e2e/us2-ledger.spec.ts`, `e2e/us3-transfers.spec.ts` on chromium, firefox, webkit and `rtl`; confirm T004 reports no violations; capture the add-form field and interaction counts and compare with `baseline.json` (SC-002) — Refs: SC-001, SC-002; FR-053
**Checkpoint**: US1 delivers value on its own (a calm add flow reachable from every screen).

---

## Phase 4: User Story 2 — A calm, well-organised app (Priority: P1)

**Goal**: Five primary sections, persistent shell with Fold switcher, sync status and lock, responsive drawer, banners, keyboard/screen-reader support, redirects.

**Independent Test**: A new tester finds five named features in ≤ 2 navigation steps; old addresses redirect (quickstart S5, S6, S16).

### Tests for User Story 2 (write first; must fail)

- [X] T055 [P] [US2] e2e `e2e/ux-shell.spec.ts`: (S5) at 1280×800 and 390×844 — exactly 5 nav entries, current marked with `aria-current`, Fold switcher + sync + lock present in one consistent region, skip link first, Tab order follows visual order, drawer opens/closes with focus restore; (S6) each old address lands on its new place with query preserved (`/transfers/` → `/transactions/?new=transfer` opens the add sheet in transfer mode); (S16) lock with the add sheet open → all overlays closed on lock; during privacy cover the sheet is inert and hidden and typed values survive uncover; second Fold switch changes the data shown — Refs: FR-001–FR-006; SC-003; R-UX-10
### Implementation for User Story 2

- [X] T056 [US2] Create `apps/web/src/ui/shell/FoldSwitcher.tsx` (always shows the current Fold name; the kit `Dropdown` switcher is offered only when `ledger.folds.length > 1`; replaces the per-screen Fold `<select>` in `apps/web/src/ui/ledger/LedgerFrame.tsx`; selecting calls the existing `ledger.selectFold`) and mount it in the sidebar header and the mobile drawer. Remove the per-screen picker from `LedgerFrame.tsx`. Depends on T041 — Refs: FR-005
- [X] T057 [P] [US2] Restyle `apps/web/src/ui/sync/SyncIndicator.tsx` as a compact status (dot + text, `role="status"`, neutral non-alarming wording when offline) placed in the sidebar footer and the mobile top bar; keep `useSyncStatus` unchanged. Add a **Lock** button (kit `Button`, icon + text) in the same region replacing the old header button; keep its `data-testid` — Refs: FR-005; spec edge cases (offline)
- [X] T058 [US2] Create `apps/web/src/ui/shell/Topbar.tsx` for widths below `lg`: menu button (opens the drawer), page title, sync dot, persistent **Add** button (≥ 44×44 px target); on wide screens the page header holds the title and Add. Exactly one `<h1>` per page (visually hidden in the top bar when duplicated). Depends on T041, T057 — Refs: FR-003, FR-007, FR-045
- [X] T059 [P] [US2] Restyle the shell banners as kit `Alert`s with priority (one at a time: removed → storage full → storage notice → kit reminder), moving `apps/web/src/ui/shell/StorageNotice.tsx` and `KitReminder.tsx` onto the kit; keep `data-testid="storage-full"` and the removed-device link to `/add/` — Refs: FR-039; R-UX-11
- [X] T060 [P] [US2] Restyle `apps/web/src/ui/shell/PrivacyCover.tsx`, `apps/web/src/ui/support/SupportGate.tsx` and `apps/web/src/ui/errors/ErrorBoundary.tsx` with kit components, preserving: no financial content rendered under the cover, previous view restored after uncover, error catalogue messages unchanged — Refs: FR-039; spec edge cases
- [X] T061 [US2] Run `e2e/ux-shell.spec.ts`, `e2e/shell.spec.ts`, `e2e/a11y.spec.ts`, `e2e/multitab.spec.ts` on chromium, firefox, webkit and `rtl`; fix findings. Depends on T056, T057, T058, T059, T060, T055 — Refs: FR-045; SC-007
**Checkpoint**: US1 + US2 give a complete new shell and the add flow.

---

## Phase 5: User Story 3 — See how I'm doing at a glance (Priority: P1)

**Goal**: Overview with a period control, four headline figures, collapsible secondary sections with remembered state, options in a menu, drill-down links.

**Independent Test**: With a month of sample data a tester states this month's spending and whether income exceeded it within 5 seconds (quickstart S7, S8).

### Tests for User Story 3 (write first; must fail)

- [X] T062 [P] [US3] e2e `e2e/ux-overview.spec.ts`: (S7) four headline figures in the first screenful with sign/text cues, collapse "By tag", reload → still collapsed, change period, reload → persisted, stated dates shown; (S8) "Include transfers" in Options → explanatory note under tiles and figures change; missing-rate notice appears as one alert with an action; empty fold shows a guided next step; breakdown row link goes to `/transactions/?category=…&from=…&to=…`. Update `e2e/bench/dashboard-50k.spec.ts` to the new route and keep its ≤ 2 s target — Refs: FR-014–FR-018; SC-004
- [X] T063 [P] [US3] Unit tests `apps/web/src/ui/overview/period.test.ts` for `resolvePeriod(choice, today)` (this/last month, this/last year, last 30/90 days, all, custom; month boundaries; leap years; returns ISO `from`/`to` and a label) and `apps/web/src/ui/overview/links.test.ts` for `breakdownHref(row, period)` (category, tag and account rows → Transactions query string per `contracts/routes.md` §4, with `account=` for account rows)
### Implementation for User Story 3

- [X] T064 [US3] Implement `apps/web/src/ui/overview/period.ts` and `links.ts` to satisfy T063; all dates are `LocalDate` strings, no `Date` arithmetic on money paths — Refs: FR-015, FR-016
- [X] T065 [US3] Create `apps/web/src/ui/overview/OverviewScreen.tsx` (move from `apps/web/src/ui/ledger/DashboardScreen.tsx`, keeping its `ledger.read` calls and `data-testid`s `income`, `expense`, `net`, `net-worth`): header with a period `Listbox` (custom opens a small `Dialog` with two date inputs) and stated resolved dates; four `Stat` tiles (Income, Expenses, Net, Total balance); Options `Dropdown` with Include adjustments / Include transfers and a text note when non-default; `prefs.overview.period` persisted. Depends on T064, T032 — Refs: FR-014, FR-015, FR-018
- [X] T066 [US3] In `OverviewScreen.tsx` render By category, By tag, Monthly trend, Balance over time and Accounts as kit `Disclosure` sections with a one-line summary when collapsed and state in `prefs.overview.collapsed`; breakdown rows (category, tag, and the per-account rows in the Accounts section) are links via `breakdownHref`; restyle the existing accessible SVG chart and its table fallback with token colours; amounts via `Amount`. Depends on T065, T031 — Refs: FR-016, FR-017, FR-042
- [X] T067 [US3] Replace the inline missing-rate form with one concise `Alert` ("Missing exchange rates for X, Y") and a button that opens a `Sheet` containing the existing rate form (`apps/web/src/ui/ledger/transfer/RateManager.tsx` restyled; same `ledger.setCustomRate`). Depends on T065 — Refs: spec US3 scenario 6
- [X] T068 [US3] Empty fold state: when there are no accounts show `EmptyState` "Create your first account" (opens the account sheet); when there are accounts but no transactions show "Add your first transaction" (opens the add sheet). Point `apps/web/src/app/overview/page.tsx` at `OverviewScreen` and delete the old route content. Depends on T065, T047 — Refs: FR-037; spec US3 scenario 7
- [ ] T069 [US3] Run `e2e/ux-overview.spec.ts`, `e2e/bench/dashboard-50k.spec.ts` and `e2e/a11y.spec.ts` (Overview) on all projects; compare control counts with `baseline.json` (SC-005) — Refs: SC-004, SC-005, SC-010
**Checkpoint**: P1 complete — add flow, shell, overview. This is the recommended MVP release candidate for the redesign.

---

## Phase 6: User Story 4 — Find and review past transactions without clutter (Priority: P2)

**Goal**: Day-grouped list with net totals, persistent search, a single Filters control with chips (mirrored in the URL), row menus, badges, banners for needs-attention and schedule inbox, Recently deleted view.

**Independent Test**: With ≥ 200 transactions find a specific entry by search + one filter in < 30 s, delete it with confirmation, restore it from Recently deleted (quickstart S9, S10).

### Tests for User Story 4 (write first; must fail)

- [X] T070 [P] [US4] e2e `e2e/ux-list.spec.ts`: (S9) day headings with net totals, the last group marked "so far" until all rows loaded, search narrows as typing with announced count, Filters panel (account, category, status, dates, amount) → chips with remove and Clear all, reload keeps filters, `?account=` still honoured; amount filters disabled with explanation until an account is chosen; (S10) row menu → Delete → confirmation names the transaction → gone → Recently deleted → Restore; badges for pending/void/pinned/refund/transfer/attachment carry text or icon + label; 10,000-row check from `quickstart.md` §4 as an `e2e/bench/list-10k.spec.ts` (p95 input-to-render < 200 ms) — Refs: FR-024–FR-027; SC-010
- [X] T071 [P] [US4] Unit tests: `apps/web/src/ui/transactions/filters.test.ts` (round-trip between filter state and URL query per `contracts/routes.md` §4; invalid values dropped; chips list built from applied filters with removable ids) and `apps/web/src/ui/transactions/day-groups.test.ts` (`DayGroup` building from rows sorted `date_desc`; net totals signed in minor units as `bigint`; only the last group is `partial` while `count > items.length`)
### Implementation for User Story 4

- [X] T072 [US4] Implement `apps/web/src/ui/transactions/filters.ts` and `day-groups.ts` to satisfy T071 (no floating point: sums are `bigint`; reuse the existing `LocalDate` helpers in `apps/web/src/ui/ledger/dates.ts`) — Refs: FR-024, FR-025
- [X] T073 [US4] Create `apps/web/src/ui/transactions/TransactionsScreen.tsx` (move from `apps/web/src/ui/ledger/TransactionsScreen.tsx`, **keeping** the `ledger.transactions` query with `sort: 'date_desc'` and `page: { limit, offset: 0 }`, the 200 ms search debounce and "load more" paging): header with persistent search `Input`, **Filters** button (shows applied-filter count) and the Add button; day groups with sticky headings and net totals via `Amount`; each row shows the category initial tinted with the category colour, the payee or note as title, category and account as subtitle and the amount via `Amount` (FR-024); rows activate the editor and have a `Dropdown` row menu (Edit, Pin/Unpin, Delete) with a ≥ 44 px target; badges via `Badge`; state in the URL via T072. Depends on T072, T052, T026, T029 — Refs: FR-024, FR-026, FR-027
- [X] T074 [US4] Create `apps/web/src/ui/transactions/FiltersPanel.tsx`: `Sheet` below `sm`, Headless `Popover` panel above; fields account, category, status, from, to, min, max with the existing parsing (`ledger.parse`) and the "choose an account to filter by amount" explanation; Apply closes the panel; `FilterChips.tsx` shows `Chip`s with remove and "Clear all"; empty result shows the no-match `EmptyState` with "Clear filters". Depends on T073, T032 — Refs: FR-025; spec US4 scenario 7
- [X] T075 [US4] Move the needs-attention panel and the schedule inbox (confirm/skip) to a dismissible `Alert` banner at the top of the list (`apps/web/src/ui/transactions/AttentionBanner.tsx`) using the existing `ledger.needsAttention` and `schedules.confirm`/`schedules.skip` calls; show a count badge on the Transactions sidebar entry when the inbox is non-empty. Move **Recently deleted** into a list-header menu view (`RecentlyDeleted.tsx`) with the existing `ledger.restoreTransaction`. Depends on T073 — Refs: FR-013; plan R-UX-14; reference 01 §3 (pending rows)
- [X] T076 [US4] Show transfers in the same list with a "Transfer" badge and both accounts in the subtitle; remove `apps/web/src/ui/ledger/transfer/TransfersScreen.tsx` once the sheet's transfer mode (T050) covers its functions; keep `RateManager.tsx` reachable from the add sheet (inline prompt) and Settings → Advanced. Update `e2e/us3-transfers.spec.ts` selectors. Depends on T073, T050 — Refs: FR-002, FR-023
- [ ] T077 [US4] Run `e2e/ux-list.spec.ts`, `e2e/bench/list-10k.spec.ts`, updated `e2e/us2-ledger.spec.ts`, `e2e/us3-transfers.spec.ts` and `e2e/a11y.spec.ts` (Transactions) on all projects. If the 10,000-row p95 misses 200 ms, add a small in-house windowing hook `apps/web/src/ui/transactions/useWindowedRows.ts` (render visible rows plus overscan) with a unit test, then re-run — depends on T074, T075, T076 — Refs: SC-010; R-UX-14
---

## Phase 7: User Story 5 — One consistent, attractive look everywhere (Priority: P2)

**Goal**: Every route, dialog, form and message uses the kit; theme switching without flash; forced-colours, reduced-motion, RTL and zoom behave; no one-off controls remain.

**Independent Test**: Theme switching has no flash, every migrated route passes axe in both themes at 320, 768 and 1920 px with no horizontal page scroll, and the raw-control audit (T112) reports no raw controls in the screens migrated so far (quickstart S11, S18). The final "zero raw controls anywhere" check runs in Phase 12.

### Tests for User Story 5 (write first; must fail)

- [X] T078 [P] [US5] e2e `e2e/ux-theme.spec.ts`: (S11) with the OS emulated dark, first paint has `data-theme="dark"` before hydration (no light flash), Light/Dark/System in Settings → Appearance apply instantly and persist across reload; `forced-colors: active` and `prefers-reduced-motion: reduce` emulations keep focus rings and state cues (sign/icon/text) visible and disable transitions; blocked `localStorage` falls back to System with no error UI (S17) — Refs: FR-041, FR-045; R-UX-05
- [X] T079 [P] [US5] e2e `e2e/ux-responsive.spec.ts`: for every primary route and each settings group at 320×640, 768×1024, 1920×1080 and 200 % zoom assert `document.documentElement.scrollWidth <= innerWidth` (no horizontal page scroll), primary actions reachable, no clipped text for 40 % longer strings (the `pseudo` Playwright project (locale `en-XA`, see T037)), and RTL mirroring in the `rtl` project; add T037 as a dependency of this task — Refs: FR-043, FR-046, FR-047; SC-008
### Implementation for User Story 5

- [X] T080 [US5] Create the **Theme** control in `apps/web/src/ui/settings/AppearanceSection.tsx` (kit `RadioGroup` Light / Dark / System with description, bound to `ThemeProvider`), and a live preview swatch. Depends on T016, T053 — Refs: FR-035, FR-041
- [X] T081 [US5] Rebuild the auth screens on the kit `AuthLayout` + fieldset components, keeping every field label, error text and `data-testid` used by e2e: `apps/web/src/ui/auth/SignUpForm.tsx`, `UnlockForm.tsx`, `SecretKeyScreen.tsx`, `RecoverScreen.tsx`, `apps/web/src/ui/devices/AddDeviceScreen.tsx`, and `apps/web/src/app/{sign-up,sign-in,recover,add}/page.tsx`. Errors replace helper text with `aria-invalid` + `aria-describedby`; password fields keep their autocomplete attributes; the Secret Key screen keeps the explicit acknowledgement (`I have saved my Secret Key`) and uses the one-time-secret presentation from T082. Depends on T025 — Refs: FR-010, FR-034, FR-039
- [X] T082 [US5] Restyle `apps/web/src/ui/settings/OneTimeSecret.tsx` into a dedicated uncluttered view: the secret in a monospace block, Copy and Download buttons, a clear "shown once" warning, and an acknowledgement `Checkbox` that gates Continue — preserving all protections from spec 001 (nothing logged, nothing persisted in the clear, `emergency-kit/` code untouched). Depends on T025, T024 — Refs: FR-034
- [X] T083 [P] [US5] Replace the remaining per-screen confirmations with one `ConfirmDialog` in `apps/web/src/ui/kit/confirm-dialog.tsx` (title naming the item, consequence text, destructive-labelled button, safe default focus) and use it in every delete/archive/finish flow (FR-012). Remove `apps/web/src/ui/forms/Modal.tsx` usages as screens migrate — Refs: FR-012
- [X] T084 [P] [US5] Restyle `apps/web/src/ui/sharing/{SharingPanel,InviteForm,InvitationsSection,MyCode,Fingerprint,QrCode}.tsx` with kit components; keep the fingerprint comparison and QR safety text and every `data-testid`; lists become `DescriptionList`/cards with member avatars and role badges. Depends on T029, T024 — Refs: FR-039
- [X] T085 [US5] Extend `e2e/a11y.spec.ts` to run its screen checks under both `colorScheme: 'light'` and `'dark'`; run `e2e/ux-theme.spec.ts`, `e2e/ux-responsive.spec.ts`, `e2e/a11y.spec.ts` and `e2e/ux-csp.spec.ts` on all projects; run the kit browser tests (T035); fix findings — Refs: SC-006, SC-007, SC-008
---

## Phase 8: User Story 6 — Plan in one place (Priority: P2)

**Goal**: One Plan section with Budgets, Goals and Schedules as tabs, progress cards with text status, essential-first forms.

**Independent Test**: Create a monthly budget, a savings goal and a weekly schedule using only Plan, each in ≤ 3 steps beyond values (quickstart S12).

### Tests for User Story 6 (write first; must fail)

- [X] T086 [P] [US6] e2e `e2e/ux-plan.spec.ts`: (S12) `/plan/` shows three tabs, `?view=` selects, last view remembered across reload; create a budget (default fields: name, limit, period, start date, categories; custom period adds end date), a goal (name, target, goal account, target date) and a weekly schedule (default fields per `contracts/form-fields.md`); cards show progress with text status (on track / near limit / over; in progress / reached / overdue) and expose `role="progressbar"`; schedule inbox/upcoming/active/finished/projected sections are collapsible and the inbox is first; update `e2e/us5-budgets.spec.ts`, `e2e/us6-schedules.spec.ts`, `e2e/us8-goals.spec.ts` selectors — Refs: FR-030, FR-031; SC-011
- [X] T087 [P] [US6] Unit test `apps/web/src/ui/plan/status.test.ts` for `budgetStatus(spent, limit)` (on track < 80 %, near limit 80–100 %, over > 100 %; all `bigint`) and `goalStatus(saved, target, dueDate, today)` (in progress / reached / overdue), each returning text key, tone and progress fraction without floating-point money (fractions only for the bar width, derived from `bigint` division at the display edge)
### Implementation for User Story 6

- [X] T088 [US6] Implement `apps/web/src/ui/plan/status.ts` to satisfy T087; the display fraction is computed at the edge with integer arithmetic scaled to basis points — Refs: FR-030; Constitution VI
- [X] T089 [US6] Create `apps/web/src/ui/plan/PlanScreen.tsx` with the kit `Tabs` (Budgets, Goals, Schedules, with counts), `?view=` synced with `prefs.plan.view`; each tab renders its view. Point `apps/web/src/app/plan/page.tsx` at it. Depends on T032, T088 — Refs: FR-030
- [X] T090 [P] [US6] Move `apps/web/src/ui/budgets/BudgetsScreen.tsx` to `apps/web/src/ui/plan/BudgetsView.tsx` keeping its commands/queries; cards via `Progress` with `statusText`; the budget form becomes a `Sheet` with the essential fields from `contracts/form-fields.md` and a "More options" `Disclosure` (every, allocation, accounts, groups, tags, rollover); Edit/Delete in a row menu with `ConfirmDialog`; link "View transactions" to the filtered list when the scope maps to list filters, otherwise omitted. Depends on T089, T083 — Refs: FR-030, FR-031
- [X] T091 [P] [US6] Move `apps/web/src/ui/goals/GoalsScreen.tsx` to `apps/web/src/ui/plan/GoalsView.tsx`: cards with target, saved, remaining, deadline and status; four-field form in a `Sheet` (name, target, goal account, target date); row menu + `ConfirmDialog`. Depends on T089, T083 — Refs: FR-030, FR-031
- [X] T092 [P] [US6] Move `apps/web/src/ui/schedules/SchedulesScreen.tsx` to `apps/web/src/ui/plan/SchedulesView.tsx`: sections (inbox with Confirm/Skip, upcoming, active, finished, projected) as collapsible `Disclosure`s with the inbox first; schedule form in a `Sheet` with essential fields and a "More options" disclosure (note, last date, confirm each, reminder); keep notification-amounts option reachable from Settings → Advanced. Depends on T089, T083 — Refs: FR-030, FR-031
- [X] T093 [US6] Delete the old `apps/web/src/ui/{budgets,goals,schedules}/` directories and their page content (now redirect stubs); run `e2e/ux-plan.spec.ts` and the updated US5/US6/US8 specs on all projects — depends on T090, T091, T092 — Refs: FR-054; FR-053
---

## Phase 9: User Story 7 — Settings that are easy to scan (Priority: P2)

**Goal**: A settings index of seven groups with one-line descriptions; each group on its own page; technical items under Advanced; Categories group with tabs.

**Independent Test**: Find "change appearance to dark", "see connected devices" and "export my data" in ≤ 2 steps (quickstart S13).

### Tests for User Story 7 (write first; must fail)

- [X] T094 [P] [US7] e2e `e2e/ux-settings.spec.ts`: (S13) `/settings/` lists ≤ 7 groups each with a description and contains no form controls; the three named tasks complete in ≤ 2 steps; Advanced holds service address and storage diagnostics each with a "when to change" sentence; the Secret Key / Emergency Kit flow shows Copy and Download, the "shown once" warning and requires the acknowledgement; Categories group shows Expense/Income/Tags/Payees tabs with archive/merge/reorder/delete in row menus and a confirmation stating how many transactions are affected; update `e2e/us9-recovery.spec.ts` and `e2e/us1-quick-unlock.spec.ts` paths — Refs: FR-029, FR-032–FR-035; SC-003
### Implementation for User Story 7

- [X] T095 [US7] Create `apps/web/src/ui/settings/SettingsIndex.tsx` (kit `DescriptionList`/card list of the seven groups from `routes.ts`, one-line description, chevron, no controls) and a shared `SettingsPage.tsx` layout (breadcrumb "Settings ›", one `<h1>`, back link on narrow screens). Point `apps/web/src/app/settings/page.tsx` at the index. Depends on T038, T029 — Refs: FR-032
- [X] T096 [P] [US7] Split `apps/web/src/ui/settings/SettingsScreen.tsx` into group pages and restyle with kit components, keeping every command (`settings.get`, `settings.set`, `emergencyKit.export`, password/email/recovery calls): `apps/web/src/ui/settings/ProfileSecurity.tsx` (account details as `DescriptionList`, `CredentialsSection`, `EmailSection`, `RecoverySection`, `QuickUnlockSection`, auto-lock selects as kit `Listbox`/`Select`, Emergency Kit export via T082). Depends on T095, T082 — Refs: FR-032, FR-034
- [X] T097 [P] [US7] `apps/web/src/ui/settings/SyncAndDevices.tsx`: sync controls (`SyncSection`), the devices list as cards with a row menu (rename/remove as today) and "Add a device" linking to `/add/`; uses `apps/web/src/ui/devices/DevicesScreen.tsx` logic moved, not rewritten. Depends on T095 — Refs: FR-032
- [X] T098 [P] [US7] `apps/web/src/ui/settings/DataAndStorage.tsx`: import (`CsvImportPanel`), export (`CsvExportPanel`), backup (`BackupPanel`) and storage persistence (`StorageSection`) restyled with kit components in a stepper-free layout; keep problem messages from `apps/web/src/ui/data/problems.ts`. Depends on T095 — Refs: FR-032
- [X] T099 [P] [US7] `apps/web/src/ui/settings/FoldsAndSharing.tsx`: Folds as cards (name, base currency, members count) with create `Sheet` and delete via `ConfirmDialog` that keeps the type-the-name confirmation (`folds.delete.confirm.label`); members and invitations via the restyled sharing components from T084. Depends on T095, T084, T083 — Refs: FR-032
- [X] T100 [P] [US7] `apps/web/src/ui/settings/Advanced.tsx`: `ServerAddress`, storage diagnostics, notification-amounts switch (`schedules.notify.amounts`) and the exchange-rate manager entry, each with a sentence explaining when to change it. Depends on T095 — Refs: FR-033
- [X] T101 [US7] `apps/web/src/ui/settings/CategoriesGroup.tsx`: move `apps/web/src/ui/ledger/CategoriesScreen.tsx` here with kit `Tabs` Expense / Income / Tags / Payees; parent/child rows expandable; row `Dropdown` with Edit, Add subcategory, Move up/down, Merge, Archive/Unarchive, Delete — **all existing commands unchanged**; archive/delete confirmation states the number of affected transactions (query already used today for merge/delete counts) via `ConfirmDialog`. Depends on T095, T083 — Refs: FR-029
- [X] T102 [US7] Remove `apps/web/src/ui/settings/SettingsScreen.tsx` once empty; run `e2e/ux-settings.spec.ts`, updated `e2e/us9-recovery.spec.ts`, `e2e/us7-sharing.spec.ts`, `e2e/us4-sync.spec.ts`, `e2e/us1-quick-unlock.spec.ts`, `e2e/a11y.spec.ts` on all projects — depends on T096, T097, T098, T099, T100, T101 — Refs: FR-053
---

## Phase 10: User Story 8 — A friendly first run and helpful empty states (Priority: P3)

**Goal**: Skippable first-run checklist, an `EmptyState` on every list, one-time hints.

**Independent Test**: A new tester completes sign-up and records a first transaction in < 5 minutes unaided (quickstart S14, §3).

### Tests for User Story 8 (write first; must fail)

- [X] T103 [P] [US8] e2e `e2e/ux-firstrun.spec.ts`: (S14) new Fold shows the checklist (create Fold ✓, add an account, add a transaction); dismiss → reload → absent; reopen from the Help entry in the sidebar footer; every list that can be empty (accounts, categories, tags, payees, budgets, goals, schedules, transactions, devices, Recently deleted) shows icon + one sentence + primary action; a first-time hint (e.g. Folds sharing) appears once, is dismissible, never blocks input and does not return; unit test `apps/web/src/ui/firstrun/checklist.test.ts` for `checklistState(basics)` deriving done/undone from existing data — Refs: FR-036–FR-038; SC-009
### Implementation for User Story 8

- [X] T104 [US8] Implement `apps/web/src/ui/firstrun/checklist.ts` (pure derivation from `ledger.basics`) and `apps/web/src/ui/firstrun/FirstRunChecklist.tsx` (kit `Alert`-style card on Overview; step actions open the account sheet / add sheet; dismiss writes `prefs.firstRun.dismissed`); a **Help** item in the sidebar footer reopens it. Depends on T068, T047 — Refs: FR-036
- [X] T105 [P] [US8] Add `EmptyState` to every list that can be empty using `apps/web/src/ui/i18n/messages/en.json` keys (icon, one-sentence purpose, primary action): `apps/web/src/ui/accounts/*`, `apps/web/src/ui/settings/CategoriesGroup.tsx`, `apps/web/src/ui/plan/{BudgetsView,GoalsView,SchedulesView}.tsx`, `apps/web/src/ui/transactions/TransactionsScreen.tsx`, `apps/web/src/ui/settings/SyncAndDevices.tsx`, `apps/web/src/ui/transactions/RecentlyDeleted.tsx`. Depends on T032 — Refs: FR-037
- [X] T106 [P] [US8] Create `apps/web/src/ui/firstrun/Hint.tsx` (≤ 2 sentences, dismiss button, id stored in `prefs.hints.dismissed`, never modal) and use it for Folds sharing, schedules confirm-each, and exchange rates; no coach-mark sequences — Refs: FR-038
---

## Phase 11: User Story 9 — Manage lists with confidence (Priority: P3)

**Goal**: Accounts as grouped cards with row menus and an archived toggle; minimal-field dialogs; consequence-stating confirmations.

**Independent Test**: Create an account in a new currency, a category with one subcategory, and archive an account — all without leaving the list (quickstart S15).

### Tests for User Story 9 (write first; must fail)

- [X] T107 [P] [US9] e2e `e2e/ux-accounts.spec.ts`: (S15) Accounts grouped by type with name, currency, current balance; "Show archived" toggle (persisted in `prefs.lists.showArchivedAccounts`); Add account `Sheet` shows name, currency, type, opening balance by default and opening-balance date/groups under "More options"; archive hides the row; delete confirmation states consequences ("N transactions will be removed" using the existing count); row menu has Add transaction, Adjust balance, Edit, Move up/down, Archive, Delete; update `e2e/us2-ledger.spec.ts` paths — Refs: FR-028; spec US9
### Implementation for User Story 9

- [X] T108 [US9] Move `apps/web/src/ui/ledger/AccountsScreen.tsx` to `apps/web/src/ui/accounts/AccountsScreen.tsx` keeping its commands (`ledger.createAccount`, `updateAccount`, `adjustBalance`, `archive`, `delete`, reorder) and `data-testid`s; render accounts grouped by type as cards (`Avatar` initial, name, currency, `Amount` balance, archived `Badge`), the archived toggle, a single "Add account" action, and a row `Dropdown` (Add transaction → `openAdd({ accountId })`, Adjust balance, Edit, Move up, Move down, Archive/Unarchive, Delete). Depends on T047, T083, T026 — Refs: FR-028
- [X] T109 [US9] Account form as a `Sheet` with essential fields (`ac.name`, `ac.currency` editable only on create, `ac.kind`, `ac.opening`) and a "More options" `Disclosure` (`ac.openingDate`, `ac.groups`); the adjust-balance dialog restyled with `Amount`; delete confirmation uses the existing transaction-count query. Depends on T108, T022 — Refs: FR-009, FR-028
- [X] T110 [US9] Run `e2e/ux-accounts.spec.ts` and updated `e2e/us2-ledger.spec.ts` on all projects; delete the old `apps/web/src/ui/ledger/AccountsScreen.tsx` — depends on T109, T107 — Refs: FR-053, FR-054
---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Remove the old UI, finalise budgets and docs, and run the release gates.

- [X] T111 Delete everything unused after migration: `apps/web/src/ui/forms/{TextField,Modal}.tsx`, `apps/web/src/ui/ledger/{TransactionForm,DashboardScreen,TransactionsScreen,CategoriesScreen,AccountsScreen}.tsx` (keep `LedgerProvider.tsx`, `AmountField.tsx` if still used, `format.ts`, `dates.ts`, `palette.ts` and their tests; keep `LedgerFrame.tsx` only if still used for the no-Fold state), retired i18n keys in `apps/web/src/ui/i18n/messages/en.json` (re-run `messages.test.ts`), and any physical `buttonClass`/`secondaryButtonClass` exports. Switch the three kit lint rules from T007 to `error`. No legacy layout, flag or classic switch may remain (FR-054). Depends on all story phases — Refs: FR-054; SC-006
- [X] T112 Component audit: run `pnpm lint` with `no-raw-controls` as an error across `apps/web/src/ui/` and fix every remaining raw `<button>/<input>/<select>/<textarea>` (allow-list only `type="file"` and hidden inputs); add `apps/web/src/ui/no-raw-controls.test.ts` that fails with the offending files if the allow-list grows. Depends on all screen-migration tasks in Phases 3–11 and on T111 — Refs: FR-039, FR-040; SC-006
- [ ] T113 [P] Full gate run on a clean checkout: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter @cashfold/web build`, `pnpm check:bundle`, `pnpm check:licenses`, `pnpm check:no-float`, `pnpm test:e2e` (chromium, firefox, webkit, rtl) and the verifiable-build check `node scripts/build-verify.mjs`; update `build-hashes/` per the repository's release process — Refs: Constitution Quality Gates; SC-007
- [X] T114 Measure the final bundles with `pnpm check:bundle`, then set `INITIAL_BUDGET` and `WORKER_BUDGET` in `scripts/check-bundle-size.mjs` to the measurement + ~6 % (the rule used in spec 001) and update its header comment with the new measurements; verify combined growth over 001's final measurement (254.5 + 266.0 KiB gz) is ≤ 70 KiB. If exceeded, apply the fallbacks in R-UX-02 (native `Select` for short lists, drop Combobox, drop Table/Pagination styling) and re-measure — depends on T111 — Refs: FR-052, SC-010; R-UX-02
- [ ] T115 [P] Re-run `e2e/bench/ui-baseline.spec.ts` against the finished UI and compare with `specs/002-ux-redesign-catalyst/baseline.json`: assert at least 40 % fewer visible interactive controls on first load for Overview, Transactions, Settings and the add form at both viewport sizes, exactly 5 primary navigation entries and at most 5 default add-form fields; write the comparison to `specs/002-ux-redesign-catalyst/quickstart-results.md`. Depends on T111 — Refs: SC-002, SC-003, SC-005
- [ ] T116 [P] Manual accessibility pass recorded in `specs/002-ux-redesign-catalyst/quickstart-results.md`: NVDA + Firefox, VoiceOver + Safari, TalkBack + Chrome for the add flow, Overview, Transactions filters and Settings; keyboard-only pass of every P1/P2 story; touch-target (≥ 44 px) and 200 % zoom review — Refs: FR-045; quickstart §3
- [ ] T117 [P] Moderated sessions (≥ 8 participants) per `quickstart.md` §3 for SC-001, SC-003, SC-004, SC-009, SC-012; record results, timings and the "too much on screen" share in `specs/002-ux-redesign-catalyst/quickstart-results.md`; open follow-up issues for misses — Refs: SC-001, SC-003, SC-004, SC-009, SC-012
- [ ] T118 [P] Walk the SC-011 checklist: for every function listed in `specs/001-secure-finance-core/spec.md` (FR-001…) confirm a reachable control in the new UI via the route and screen map; record pass/fail per row in `quickstart-results.md`; any missing function is a blocker bug, not a follow-up — Refs: SC-011, FR-048
- [X] T119 [P] Docs: add `docs/adr/0008-catalyst-ui-kit.md` (decisions from R-UX-01, 02, 05, 10: vendored kit isolation, dropped `motion`, attribute-driven theming, overlay inertness); update `docs/ARCHITECTURE.md` UI section (shell, routes, prefs, kit boundary); update `docs/self-hosting.md` if font paths or CSP guidance changed; update `docs/threat-model.md` with the vendored-UI-code residual risk and the localStorage preference store; update the `README.md` screenshots section if present — Refs: Constitution VIII; R-UX-01
- [ ] T120 Release readiness: confirm T001 is closed and its reply is recorded; every task in this file is checked; `quickstart.md` §1–§5 pass; confirm that every change reached the integration branch through its own small, single-concern, squash-merged PR (Constitution Workflow), that T002 is closed, and that no commit message or PR description contains AI-tool attribution or co-author lines (disable any automatic co-author trailer for this repository); tag the release notes with the UX changes and the preference reset location (Settings → Appearance) — Refs: Constitution Workflow

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)**: no dependencies, start immediately. T001 (licence) gates all kit work in Phase 2; T002 (release rollup sign-off) must be decided before any feature PR merges; T003 (baseline) must finish before any UI change merges.
- **Phase 2 (Foundational)**: depends on Phase 1. Blocks every user story.
- **Phases 3–5 (P1: US1, US2, US3)**: depend on Phase 2. US1 needs the shell skeleton (T044 area) but not US2's refinements; US3 needs the add sheet host for its empty-state action (T060 depends on the host task in US1).
- **Phases 6–9 (P2: US4, US5, US6, US7)**: depend on Phase 2. US4 additionally depends on US1's edit flow; US6 and US7 depend on the shared confirm dialog task in US5; US7's Folds page depends on US5's sharing restyle.
- **Phases 10–11 (P3: US8, US9)**: US8 depends on US1 (add host) and US3 (empty fold state); US9 depends on US1 (add host) and US5 (confirm dialog).
- **Phase 12 (Polish)**: depends on all story phases; the cleanup task precedes the raw-control audit and the budget measurement.

### Within each story

1. Tests (e2e and unit) first, confirmed failing.
2. Pure helpers, then components, then screens, then wiring/route changes.
3. Update the affected existing e2e specs in the same PR as the screen they cover.

### Story dependency graph

```text
Setup ──> Foundational ──┬─> US1 ──┬─> US4 ──┐
                         │         ├─> US8   │
                         ├─> US2   └─> US9   ├─> Polish
                         ├─> US3 ───> US8    │
                         ├─> US5 ──┬─> US6 ──┤
                         │         ├─> US7 ──┤
                         │         └─> US9 ──┘
```

## Parallel Execution Examples

- **Setup**: the tasks marked [P] in Phase 1 in parallel after T001 starts (T005 first if the lockfile must exist for others).
- **Foundational kit**: after T017-ish `kitlic`, the six port tasks (`button…`, `input…`, `dialog…`, `listbox/combobox`, `navbar…`, `table…`) and the three authored-extension tasks are independent files and run in parallel.
- **US1**: the e2e test task and the unit-test task in parallel; then `PayeeField`/`TagsField`/`PlaceField` (one task, several files) alongside the `AddSheet` shell.
- **US7**: the six settings group pages (`setprofile`, `setsync`, `setdata`, `setfolds`, `setadv`) in parallel once the index/layout task is done.
- **US6**: Budgets, Goals and Schedules views in parallel after `PlanScreen`.

## Implementation Strategy

1. **MVP**: Phases 1–3 (Setup, Foundational, US1) already deliver the biggest felt improvement: a five-field add flow in the new look inside the new shell. Validate with the baseline comparison (SC-002) before continuing.
2. **P1 complete**: add US2 and US3 and run the moderated sessions for SC-001, SC-003, SC-004 early (they are inexpensive and de-risk the IA).
3. **P2**: US4 → US5 → US6 → US7. US5's confirm dialog and sharing restyle unblock US6/US7/US9, so schedule it right after US4 or in parallel with it.
4. **P3 and finish**: US8, US9, then Phase 12: delete old code, set budgets from measurement, accessibility pass, SC-011 coverage walk, docs.
5. **Bail-outs** (pre-agreed): if the bundle ceiling (+70 KiB combined) is exceeded, apply the fallbacks in R-UX-02; if the licence is refused (T001), switch kit tasks to independent authoring and re-estimate before Phase 2 continues.
