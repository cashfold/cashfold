# Implementation Plan: Calm, Task-Focused UX and Design-System UI

**Branch**: `002-ux-redesign-catalyst` | **Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-ux-redesign-catalyst/spec.md`. Reference study used to shape the work: [`docs/reference/reference-app/`](../../docs/reference/reference-app/) (screens in `01-…`, rules in `02-…`, settings/system in `03-…`). Governing rules: [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) (**Constitution I–IX**). Prior art: [spec 001 plan](../001-secure-finance-core/plan.md) (**R-n** = its research, **R-UX-n** = [this feature's research](research.md)).

## Summary

Rebuild the presentation layer of `apps/web` on a vendored, isolated copy of the Catalyst UI kit (Headless UI + Tailwind v4, no `motion`), with an emerald accent and the Ubuntu typeface bundled locally. Reduce the 12-link header to five sections (Overview, Transactions, Accounts, Plan, Settings) inside a responsive sidebar shell; move Fold switching, sync status and Lock into the shell; move Transfers into the Transactions section, Budgets/Goals/Schedules into Plan, and Categories/Data/Devices/Folds into Settings. Apply progressive disclosure through a field registry and a small device-local preferences store (`localStorage`, never synced). Replace the add form with a bottom-sheet/dialog that shows five fields by default, and rebuild Overview, Transactions, Plan, Settings and the auth screens on shared components.

**No change** to `packages/core`, `packages/crypto`, `packages/protocol`, `apps/server`, the Core Worker's commands and queries, the event log, sync or any stored data (FR-048). The work lives in `apps/web/src/ui`, `apps/web/src/app` (routes, tokens), a few build scripts and the e2e suite.

The reference study contributed interaction patterns only; the screen-by-screen adopt/adapt/decline decisions are in [contracts/screen-map.md](contracts/screen-map.md).

## Technical Context

**Language/Version**: TypeScript strict (as 001), ES modules, React 19, Next.js 16 App Router with `output: 'export'`.

**Primary Dependencies** (new ones in bold; all exact-pinned, each justified in Complexity Tracking):
- Existing: Next.js, React, Tailwind CSS 4.3 with `@tailwindcss/postcss`, `intl-messageformat`, `zod`.
- **`@headlessui/react` 2.2.x** (MIT): behaviour of dialog, menu, listbox, combobox, tabs, disclosure, switch, checkbox, radio.
- **`clsx`** (MIT): class composition used throughout the kit.
- **`@heroicons/react`** (MIT): icons, named imports.
- **`@fontsource/ubuntu`** (UFL-1.0), **devDependency only**: source of unmodified `woff2` files copied at build.
- Vendored (not an npm dependency): Catalyst components, under the Tailwind Plus License, isolated in `apps/web/src/ui/kit/` (R-UX-01).
- **Not adopted**: `motion` (≈ 46 KiB gz for a decorative effect, R-UX-02).

**Storage**: No new persistent domain storage. One device-local `localStorage` key, `cashfold.ui`, for presentation preferences ([data-model.md](data-model.md), R-UX-08). The encrypted SQLite store, IndexedDB key store and OPFS are untouched.

**Testing**: Vitest (unit; test-first for `visibleFields`, prefs, route table, filter-chip serialisation, day grouping, contrast pairs), Playwright with `@axe-core/playwright` (e2e on chromium, firefox, webkit, `rtl`), the existing leak scan, bundle and licence gates.

**Target Platform**: Evergreen desktop and mobile browsers (as 001). Layouts verified at 320, 768 and 1920 px, 200 % zoom, RTL, light/dark, forced-colours and reduced motion.

**Project Type**: Web application (existing static client + relay). This feature touches the client only.

**Performance Goals**: Initial and lazy JS within re-set budgets (≈ 290–305 / 290–300 KiB gz, hard ceiling +70 KiB combined over 001's final measurement, R-UX-02). Spec 001 targets still hold: dashboard ≤ 2 s and add-transaction update ≤ 200 ms at 50,000 transactions. List input-to-render p95 < 200 ms at 10,000 loaded rows.

**Constraints**: Strict CSP with no inline styles; no `style=` in prerendered HTML; Trusted Types on; no third-party requests; fully offline for P1/P2 flows; RTL via logical utilities only; WCAG 2.2 AA; touch targets ≥ 44 px; `core` untouched.

**Scale/Scope**: About 35 existing screens/components reworked: shell (1), auth (5), ledger (6), transfers (3), budgets/goals/schedules (3), settings (9), sharing (6), data (4), folds/devices (3), plus new shared kit (≈ 35 files).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Pre-research | Post-design |
|---|---|---|---|
| I | Zero-knowledge by construction | PASS: no data path changes | PASS: preferences are presentation-only, contain ids and enums, never leave the device; leak scan updated to assert it |
| II | DDD in `core` | PASS: `core` not touched | PASS: no domain logic added to the UI; `visibleFields`, `DayGroup` and similar are presentation helpers in `ui/` |
| III | Clean / Hexagonal | PASS | PASS: kit isolated behind a barrel; lint rule forbids `@headlessui/react` outside `ui/kit/`; UI depends inward only |
| IV | CQRS | PASS: reads via existing queries, writes via existing commands | PASS: no new command or query; `DayGroup.partial` avoids a new query (data-model §3) |
| V | Event sourcing / CRDT | PASS: untouched | PASS |
| VI | Exact money | PASS | PASS: `Amount` display component formats `bigint` minor units; `check-no-float` still covers `ui/ledger`; amount parsing unchanged (no expressions, Q1) |
| VII | Local-first | PASS | PASS: nothing new needs the network; fonts and icons are bundled; e2e offline-reload spec re-run with the new shell |
| VIII | Security hygiene | PASS with risks | PASS with documented controls: CSP/Trusted Types compatibility (R-UX-03), SRI and CSP hashes for the theme bootstrap script (R-UX-05), pinned dependencies and licence/SBOM gates (kit deps), overlays inert under the privacy cover (R-UX-10). Residual: vendored third-party UI code is reviewed once at port time and then owned. |
| IX | Simplicity / YAGNI | PASS with justification | See Complexity Tracking. No new patterns beyond the kit, a field registry and a prefs module. `motion`, custom keypad, drag-and-drop reordering, layout options and bottom tab bar were rejected. |

Technology constraints check: Next.js static export, Tailwind, TypeScript strict ✔; server components/actions still unused for user data ✔; CI blockers remain in force (type-check, lint incl. boundaries and no-float, tests, build, audit, licence, bundle budget, axe/WCAG 2.2 AA) ✔; no AI-attribution lines in commits ✔ (see the project's workflow rule).

**Gate result: PASS** with two open items that block the first merge, not the planning: the licence confirmation (WS0-1) and the measured budget re-set (WS8-3).

## Project Structure

### Documentation (this feature)

```text
specs/002-ux-redesign-catalyst/
├── plan.md                      # this file
├── research.md                  # R-UX-01 … R-UX-17
├── data-model.md                # preferences, field registry, view models
├── quickstart.md                # baseline capture, gates, scenarios, manual checks
├── baseline.json                # produced by quickstart §0 (before any UI change)
├── contracts/
│   ├── routes.md                # nav, settings groups, redirects, query state, shell regions
│   ├── ui-kit.md                # kit directory, deps, port rules, authored components, tokens, gates
│   ├── form-fields.md           # field classification per form
│   ├── screen-map.md            # reference → Cashfold adopt/adapt/decline
│   └── preferences.schema.json  # cashfold.ui schema
├── checklists/requirements.md
└── tasks.md                     # created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/
├── public/fonts/                         # NEW: unmodified Ubuntu woff2 + UFL.txt (copied at prebuild)
├── scripts/
│   ├── copy-fonts.mjs                    # NEW: copies from @fontsource/ubuntu, writes @font-face css fragment
│   ├── harden-html.mjs                   # EDIT: also hash the theme bootstrap script; fail on style= attributes
│   └── build-sw.mjs                      # EDIT: precache fonts
├── src/
│   ├── app/
│   │   ├── tokens.css                    # EDIT: emerald/zinc tokens, [data-theme], @custom-variant dark, @font-face
│   │   ├── globals.css                   # EDIT: base type, tabular numerals utility
│   │   ├── layout.tsx                    # EDIT: pre-paint theme script, html attrs
│   │   ├── overview/page.tsx             # NEW (from dashboard)
│   │   ├── plan/page.tsx                 # NEW
│   │   ├── settings/{profile,appearance,categories,sync,data,folds,advanced}/page.tsx   # NEW
│   │   └── {dashboard,transfers,budgets,goals,schedules,categories,data,devices,folds}/page.tsx   # EDIT: redirect stubs only
│   └── ui/
│       ├── kit/                          # NEW: Catalyst-derived components + authored extensions (contracts/ui-kit.md)
│       ├── prefs/                        # NEW: store, schema, hooks, migrate, visibleFields, field registry
│       ├── theme/                        # NEW: ThemeProvider, bootstrap script source
│       ├── shell/                        # REWRITE: AppShell, SidebarNav, Topbar, FoldSwitcher, OverlayHost, banners, PrivacyCover (restyle)
│       ├── overview/                     # NEW (from ledger/DashboardScreen)
│       ├── transactions/                 # NEW home for list, filters panel, chips, row menu, AddSheet, forms (from ledger/*)
│       ├── accounts/  plan/  settings/  folds/  devices/  data/  auth/  sharing/   # RESTYLE in place; move where the route map requires
│       ├── forms/                        # REMOVE after migration (TextField, Modal replaced by kit)
│       └── i18n/messages/en.json         # EDIT: new keys, retire unused ones
├── ../../eslint-rules/                   # NEW rules: no-raw-controls, no-headless-outside-kit, no-name-on-headless
└── ../../e2e/                            # EDIT existing specs; NEW ux-*.spec.ts; bench/ui-baseline.spec.ts
scripts/check-bundle-size.mjs             # EDIT: new budgets + kit share line
scripts/check-licenses.mjs                # EDIT: UFL asset exception with reason
scripts/gen-third-party-notices.mjs       # EDIT: include font + vendored kit
THIRD_PARTY_NOTICES.md                    # EDIT
```

**Structure Decision**: Reuse the existing `apps/web` layout. Screens keep their data hooks and worker calls and are *moved and rewrapped*, not rewritten, wherever the route map allows. This keeps every domain behaviour byte-identical (FR-048) and makes the change reviewable per screen. All Catalyst-derived code is in one directory (`ui/kit`) so the licence boundary, the RTL port and the fallback in R-UX-01 are each a one-directory concern.

## Delivery Plan

Slices are ordered so that each merges green on its own (small, single-concern, squash-merged PRs per the workflow rules), and the app remains usable between slices. The old and new shells never coexist in a shipped build (FR-054). See **Release strategy** below: every slice is merged into a protected long-lived integration branch, which is released to `main` once, with the old components already deleted.

### Release strategy

- All slices are small, single-concern PRs, squash-merged into the long-lived protected branch `002-ux-redesign-catalyst`, which has the same review and green-CI requirements as `main` (Constitution Workflow).
- `main` keeps the old interface throughout. Because the Foundational skeleton changes the shell for everyone, no slice may go to `main` on its own.
- When Phase 12 is complete, the branch is released to `main` by a rollup PR that contains no new changes, only the already-reviewed PRs. Since the constitution requires small PRs, the owner must explicitly accept the rollup as a release step (gate in tasks.md: *release rollup sign-off*), or amend the constitution in a separate change. The decision is recorded in `docs/adr/0008-catalyst-ui-kit.md`.
- Rejected alternatives: a build-time "v2" flag on `main` (needs a second copy of each moved screen and doubles e2e runs, and FR-054 forbids a shipped flag); merging slices to `main` directly (ships a hybrid UI).

### Workstream 0 — Gates and baseline (blocks everything)

| # | Work | Output |
|---|---|---|
| WS0-1 | **Licence confirmation** (R-UX-01). Owner asks Tailwind support, records the answer in `research.md`. If refused, switch to the fallback path (independently authored kit). | go / no-go |
| WS0-1b | **Release rollup sign-off** (see Release strategy): owner accepts the integration-branch release or amends the constitution. | decision recorded |
| WS0-2 | **Baseline capture** (quickstart §0). `e2e/bench/ui-baseline.spec.ts` → `baseline.json`. | SC-002/003/005 reference |
| WS0-3 | Dependency review: pin `@headlessui/react`, `clsx`, `@heroicons/react`, `@fontsource/ubuntu`; run audit, licence, SBOM, lockfile. | PR with lockfile only |
| WS0-4 | CSP/Trusted-Types e2e fixture (`securitypolicyviolation` listener) added to the **existing** suite first, so regressions are caught from the start. | fixture + `ux-csp.spec.ts` |

### Workstream 1 — Foundations (tokens, theme, font, kit)

| # | Work | Spec / Research |
|---|---|---|
| WS1-1 | Tokens: emerald/zinc, `[data-theme]`, `@custom-variant dark`; extend `tokens.test.ts` (test-first) | FR-040–042, R-UX-05, 06 |
| WS1-2 | Fonts: `copy-fonts.mjs`, `@font-face` with `unicode-range`, preloads, UFL notice, licence exception | R-UX-07 |
| WS1-3 | Theme bootstrap script + `ThemeProvider`; `harden-html` hashes it; no-flash e2e | FR-041 |
| WS1-4 | `ui/prefs` (schema, defensive parse, store, hooks, migrate) test-first; leak-scan assertion | R-UX-08, data-model §1 |
| WS1-5 | Port primitives into `ui/kit` with the port rules (logical utilities, no motion, Link→Next, primary token, no `name`): button, input, textarea, select, fieldset, checkbox, radio, switch, text, heading, badge, divider, link, avatar, alert | contracts/ui-kit §3 |
| WS1-6 | Port overlays and layouts: dialog (+`sheet` placement), dropdown, listbox, combobox, navbar, sidebar, sidebar-layout, stacked-layout, auth-layout, table, description-list, pagination (only if used) | |
| WS1-7 | Author extensions: sheet, disclosure, tabs, stat, amount, progress, chip, empty-state, status-message (+ `StatusProvider`), icons | contracts/ui-kit §4; FR-013 |
| WS1-7b | Test-only pseudo-locale `en-XA` and its Playwright project | FR-046 |
| WS1-8 | Lint rules: no-raw-controls, no-headless-outside-kit, no-name-on-headless; `logical-layout.test.ts` over `ui/kit` | R-UX-03, 04 |
| WS1-9 | Kit gallery page (dev-only route excluded from the export, or a Vitest browser story) used for the visual review and axe in both themes | SC-006/007 |

### Workstream 2 — Shell and routing (reference [01 §1](../../docs/reference/reference-app/01-navigation-and-screens.md))

| # | Work | Spec |
|---|---|---|
| WS2-1 | Route table + redirect stubs + unit test of the table | FR-001, 002, 006 |
| WS2-2 | `AppShell`: sidebar layout, five entries, Fold switcher, sync, Lock, banners, skip link, single `h1`/`main` | FR-001–005 |
| WS2-3 | `OverlayHost`, `inert` under cover, close-on-lock | R-UX-10 |
| WS2-4 | Update `shell.spec`, `a11y.spec` (SCREENS list), `offline-reload.spec` for the new nav | FR-053 |

### Workstream 3 — Add transaction (P1, US1; reference [01 §4.5–4.6](../../docs/reference/reference-app/01-navigation-and-screens.md))

| # | Work | Spec |
|---|---|---|
| WS3-1 | Field registry + `visibleFields()` (test-first) | FR-009, 020, 021 |
| WS3-2 | `AddSheet` (`?new=` deep link), type switch, recents defaults, dirty check, busy state, inline rate prompt | FR-007, 008, 011, 022, 023 |
| WS3-2b | Transfer mode in the same sheet (moves `TransferForm`/`suggest` logic; same command and payload) | FR-023 |
| WS3-3 | Place (name + locate, coordinates disclosure), tags combobox, payee combobox, attachment field restyle | FR-020 |
| WS3-4 | Edit flow reuses the sheet; hidden-but-filled fields shown | edge cases |
| WS3-5 | Appearance → optional fields toggles | FR-021, 035 |
| WS3-6 | `ux-add.spec.ts`; update `us2-ledger`, `us3-transfers` specs | FR-053 |

### Workstream 4 — Overview (P1, US3; reference [01 §3, §4.10](../../docs/reference/reference-app/01-navigation-and-screens.md))

Period listbox + custom range dialog; four `Stat` tiles; Options dropdown; collapsible sections with remembered state; breakdown rows linking to filtered Transactions; missing-rate notice (one concise alert that opens the rate manager); empty-state guidance. Reuses `ledger.dashboard` and friends unchanged. Spec: FR-014–018. Tests: `ux-overview.spec.ts`, update `bench/dashboard-50k`.

### Workstream 5 — Transactions list (P2, US4; reference [01 §3, §4.14](../../docs/reference/reference-app/01-navigation-and-screens.md))

Search field, Filters panel and chips mirrored in the URL, day groups with net totals and the `partial` rule, row menu, badges, needs-attention banner, schedule inbox banner, Recently deleted view, empty/no-match states, scroll preservation. Windowing only if the 10,000-row check fails. Spec: FR-024–027, FR-013. Tests: `ux-list.spec.ts`; update `us2-ledger`.

### Workstream 6 — Accounts, Plan, Settings, Folds, Devices, Data (P2/P3, US6, 7, 9; reference [01 §4.1–4.4, 4.15–4.21, 4.29–4.31](../../docs/reference/reference-app/01-navigation-and-screens.md))

1. Accounts list/cards with groups, archived toggle, row menu (move up/down, adjust balance, edit, archive, delete) — FR-028.
2. Settings root + seven group pages; move existing sections as-is into their groups (profile, security, recovery, quick unlock, storage, sync, devices, data panels, folds and sharing); Advanced; one-time-secret view — FR-032–035.
3. Categories group (tabs Expense/Income/Tags/Payees; merge/archive/reorder/delete in row menu) — FR-029.
4. Plan tabs with cards, progress and text status; essential/optional forms — FR-030, 031.
5. Update `us5-budgets`, `us6-schedules`, `us7-sharing`, `us8-goals`, `us9-recovery`, `us4-sync` for new paths.

### Workstream 7 — Auth, first run, empty states (P3, US8; reference [01 §4.53–4.54](../../docs/reference/reference-app/01-navigation-and-screens.md))

Auth layout for sign-up/in, Secret Key, recover, add device; first-run checklist (`firstRun.dismissed`); `EmptyState` on every list; one-time hints; Help entry to reopen the checklist. Spec: FR-036–038. Tests: `us1-account`, `us1-quick-unlock`, `us9-recovery` updated; `ux-firstrun.spec.ts`.

### Workstream 8 — Hardening and release

| # | Work |
|---|---|
| WS8-1 | Delete `ui/forms`, old screens, retired i18n keys; make sure no raw controls remain (lint passes without allow-list growth) — FR-054 |
| WS8-2 | `ux-responsive.spec.ts` (320/768/1920, 200 % zoom), RTL visual checks, forced-colours and reduced-motion — SC-008 |
| WS8-3 | Measure bundles; set the new budgets = measurement + ~6 %; verify ≤ +70 KiB combined; update the script header comment as 001 did — FR-052 |
| WS8-3b | Re-run the baseline recorder and assert ≥ 40 % fewer controls on Overview, Transactions, Settings and the add form | SC-005 |
| WS8-4 | Run quickstart §3 moderated sessions; record results in `quickstart-results.md` (as 001) |
| WS8-5 | Docs: `docs/ARCHITECTURE.md` UI section, third-party notices, `self-hosting.md` (fonts path/CSP unchanged), a short ADR `0008-catalyst-ui-kit.md` recording R-UX-01/02/05/10 |
| WS8-6 | Flip off any temporary compatibility; `pnpm verify` and `pnpm test:e2e` green on all projects; rollup PR to `main` after sign-off |

## Reference Traceability (how the docs shaped the plan)

| Plan item | Reference doc | What it contributed |
|---|---|---|
| Five sections and shell (WS2) | [01 §1.3–1.5](../../docs/reference/reference-app/01-navigation-and-screens.md) | Section set, always-reachable add, persistent banners |
| Add sheet and field visibility (WS3) | [01 §4.5–4.6](../../docs/reference/reference-app/01-navigation-and-screens.md), [02 §2.3](../../docs/reference/reference-app/02-data-model-and-rules.md) | Field list, "show/hide fields" and defaults idea, dirty-check, tags limit of 3 |
| Overview tiles and period (WS4) | [01 §3, §4.10](../../docs/reference/reference-app/01-navigation-and-screens.md), [02 §3.1, §3.4](../../docs/reference/reference-app/02-data-model-and-rules.md) | Four-tile pattern, period groups, drill-down, option toggles with explanation |
| List, filters, chips (WS5) | [01 §3, §4.8, §4.14, §4.28](../../docs/reference/reference-app/01-navigation-and-screens.md) | Day grouping/summaries, filter-behind-a-button with "applied" indicator, search |
| Plan cards (WS6) | [01 §4.15–4.21](../../docs/reference/reference-app/01-navigation-and-screens.md), [02 §3.5–3.6](../../docs/reference/reference-app/02-data-model-and-rules.md) | Progress/remaining/overdue states, budget display modes, schedule confirm/reminder model |
| Settings grouping (WS6) | [01 §4.29–4.41](../../docs/reference/reference-app/01-navigation-and-screens.md), [03 §1](../../docs/reference/reference-app/03-settings-sync-pro-system.md) | Grouped root, advanced separated, security rows |
| First run and empty states (WS7) | [01 §4.53–4.54](../../docs/reference/reference-app/01-navigation-and-screens.md), [03 §10](../../docs/reference/reference-app/03-settings-sync-pro-system.md) | Welcome → first account → first transaction path, per-list empty texts, tip philosophy |
| What was deliberately left out | [03 §6–7](../../docs/reference/reference-app/03-settings-sync-pro-system.md) | Paid tiers, paywall, promos, rating prompts, icon packs |

## Risks and Mitigations

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Tailwind Plus licence unsuitable for an AGPL repository | Medium / High (blocks vendoring) | WS0-1 go/no-go; isolation in `ui/kit`; independent-kit fallback (R-UX-01) |
| Bundle growth beyond +70 KiB | Medium / Medium | Drop `motion` (done), lazy overlays, native `Select` for short lists, drop Combobox if needed, measure in each PR (kit share printed) |
| CSP or Trusted Types violations from Headless UI | Low–Medium / High | e2e violation fixture from day one, no `name`, no `style=` check (R-UX-03) |
| Overlay content visible under privacy cover | Medium / High (privacy) | `OverlayHost` (R-UX-10) + test S16 |
| Contrast failures from the kit defaults | High if unaddressed / Medium | Token pair contract + unit test (R-UX-06); axe on every screen in both themes |
| Wide e2e churn from renamed routes/labels | High / Low | Keep landmark names, `aria-current`, `data-testid`; update specs in the same PR as each screen |
| Perception: users lose features they can no longer see | Medium / Medium | Every function stays reachable (SC-011 checklist), "More details" remembers state, empty states and hints explain |
| Ubuntu glyph coverage (CJK, Arabic, Hebrew) | Low / Low | System fallback accepted in the spec; `lang`-specific stack where needed |
| Scope creep into new features (undo, duplicate, expressions, dashboard modes) | Medium / Medium | Out of scope list in the spec; screen-map "Decline" rows; plan review rejects additions without a spec change |

## Complexity Tracking

> Filled because Principle IX requires every added dependency, layer or abstraction to be justified.

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Vendored Catalyst kit (`ui/kit`, ≈ 35 files) | Mandated by the request (FR-039); gives accessible, consistent components | Hand-styling every screen is what produced today's inconsistency; a third-party component library other than the requested one contradicts the request |
| `@headlessui/react` | The kit's behaviour layer (dialog, menu, combobox, tabs). Replacing it means re-implementing and re-testing accessible overlays | Native `<dialog>`/`<select>` only: no accessible menus/comboboxes, and the kit would not work as designed |
| `clsx` | Used by every kit file; tiny | Template strings: error-prone for conditional classes, diverges from the kit |
| `@heroicons/react` | One coherent icon set (FR-044); per-icon tree-shaking | Inline SVG per icon: duplicates work; an icon font: not accessible, harder to bundle |
| `@fontsource/ubuntu` (dev-only) | Verified, unmodified UFL font files with correct subsets | Self-converting the font is a "modified version" under UFL and needs extra tooling |
| `ui/prefs` module | Device-local presentation state needed by 5 stories (theme, remembered disclosure, period, plan tab, recents) | Reusing the Core Worker's settings store: async (breaks pre-paint theme), mixes presentation with security settings, pulls UI into the worker |
| Field registry + `visibleFields()` | One place that guarantees the ≤ 6-field rule, the hidden-but-filled rule, and settings toggles | Ad hoc `showMore` booleans per form: untestable, drifts, violates FR-009 by accident |
| Theme bootstrap inline script (hashed) | Prevents a flash of the wrong theme (FR-041) | Applying theme after hydration: visible flash; a cookie: needs a server |
| Three lint rules | Make the kit boundary and CSP constraints enforceable instead of conventional | Code review only: previous gates in this repo show conventions erode without lint |
| Redirect stub pages | Required by FR-006 on a static host | Host-level redirects: not available to every self-hoster |
| Dropped: `motion`, custom keypad, bottom tab bar, drag-and-drop, layout options, list virtualization (unless proven necessary) | — | Each fails the YAGNI test against the spec's stories; reasons in research |
