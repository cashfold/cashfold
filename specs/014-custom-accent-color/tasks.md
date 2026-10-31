---

description: "Task list for Custom Primary Color"
---

# Tasks: Custom Primary Color

**Input**: Design documents from `/specs/014-custom-accent-color/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md

**Tests**: Included, because the constitution requires tests and accessibility checks for user-facing work.

**Format**: `- [ ] [ID] [P?] [Story] Description with file path` (`[P]` = can run in parallel)

Paths under `apps/web/src/ui/` are written `ui/...`. Phases 3 and 4 ship without Phase 5; Phase 5 is separable and can be dropped (see plan.md, R7).

## Phase 1: Setup

- [X] T001 Confirm on branch `014-custom-accent-color` (create it from `main` if still on another branch) and run `pnpm --filter ./apps/web test` once to record a green baseline
- [X] T002 Search `apps/web/src` for hard-coded green/emerald colors that bypass the `--primary` tokens (e.g. `emerald`, `green-`, `#047857`, `#10b981`, and any use of `--color-primary` / `--color-accent` mappings in `app/tokens.css` that bypass `--primary`) and list them in a comment on T013; do not change them yet

## Phase 2: Foundational

- [X] T003 Create `ui/theme/palette.ts`: the curated list of about ten colors (`emerald` default, blue, indigo, violet, pink, red-orange, amber, teal, slate, and one more; the final list is fixed in this task, and any color that fails the contrast test T006 is replaced or dropped, not shipped), each with `id`, name message key, and per theme (`light`, `dark`) the values `primary`, `onPrimary`, `accentText`, `focus`. Export `PrimaryChoice` (the ids), `DEFAULT_PRIMARY = 'emerald'` and `parsePrimary(x: unknown): PrimaryChoice` that returns the default for any unknown value. Emerald must equal the current `tokens.css` values exactly.
- [X] T004 [P] Add the field `primary: PrimaryChoice` (default `'emerald'`) to `Prefs` and `DEFAULT_PREFS` in `ui/prefs/schema.ts`, parsed with `parsePrimary` field by field (an invalid value falls back to the default without touching other fields); keep `v: 1`. Cover it in `ui/prefs/schema.test.ts` and `ui/prefs/migrate.test.ts` (old stored prefs without the field load with the default)
- [X] T005 [P] Add strings to `ui/i18n/messages/en.json`, `uk.json`, `pl.json`: `settings.appearance.primary`, `settings.appearance.primary.description`, `settings.appearance.primary.default`, one name per palette color (`settings.appearance.primary.<id>`), and `settings.appearance.primary.installedNote` (installed app icons update after reinstalling). Keep keys sorted and `ui/i18n/catalogue-complete.test.ts` green

**Checkpoint**: palette, prefs field and strings exist; nothing visible yet.

## Phase 3: User Story 1 - Choose the app's primary color (P1) 🎯 MVP

**Goal**: Picking a color in Appearance re-themes the whole app at once, persists, and never flashes at launch.

**Independent Test**: Change the color in Settings → Appearance and browse Overview, Accounts, Transactions and Settings: primary buttons, selection, links, focus ring and chart accent use the new color in light and dark; reload shows no flash; Default restores green; negative amounts stay red.

### Tests for User Story 1

- [X] T006 [P] [US1] Create `ui/theme/palette.test.ts`: for every color and theme, text on `primary` (`onPrimary`) ≥ 4.5:1, `accentText` on `bg` and on `surface` ≥ 4.5:1, `focus` and `primary` against `bg` ≥ 3:1 (reuse the contrast helper in `ui/tokens.test.ts`); ids are unique; `parsePrimary` falls back for `undefined`, numbers and unknown strings
- [X] T007 [P] [US1] Extend `ui/tokens.test.ts` (or add `ui/theme/tokens-primary.test.ts`) so every `[data-primary="<id>"]` block in `app/tokens.css` exists for each palette id and matches `palette.ts` values for both themes
- [X] T008 [P] [US1] Add a test in `ui/theme/tokens-primary.test.ts` that no `[data-primary]` block sets `--danger`, `--on-danger`, `--success`, `--warning` or `--cue-*` (FR-005)
- [X] T009 [P] [US1] Extend `ui/theme/resolve-theme.test.ts` (the existing bootstrap-equivalence test): the inline bootstrap sets `data-primary` exactly as `parsePrimary` would for valid, missing and invalid stored values
- [X] T010 [P] [US1] Create `ui/settings/AppearanceSection.browser.test.tsx` (pattern of `ui/kit/kit.browser.test.tsx`): selecting a swatch sets `document.documentElement.dataset.primary`, updates stored prefs, is operable with the keyboard, and a second window/tab reflects the change via the existing prefs store event

### Implementation for User Story 1

- [X] T011 [US1] Generate the `[data-primary="<id>"]` and `[data-theme="dark"][data-primary="<id>"]` override blocks in `app/tokens.css` from `ui/theme/palette.ts` (override only `--primary`, `--on-primary`, `--accent-text`, `--focus`; do not touch `--danger`, `--success`, `--warning`, `--cue-*`). Add a comment saying `palette.ts` is the source and `tokens-primary.test.ts` fails if they drift
- [X] T012 [US1] Extend `THEME_BOOTSTRAP` in `ui/theme/bootstrap.ts` to read `primary` from `cashfold.ui`, validate it against the palette ids inlined as a literal list, and set `html.dataset.primary` (no `style=` attribute; stay self-contained). Run `pnpm --filter ./apps/web build` and confirm `scripts/harden-html.mjs` still produces the CSP hash
- [X] T013 [US1] Replace every hard-coded green found in T002 with the matching token (`bg-primary`, `text-accent-text`, etc. as used in `ui/kit/button.tsx`), including the chart main accent
- [X] T014 [US1] In `ui/theme/ThemeProvider.tsx` apply `primary` from prefs to `document.documentElement.dataset.primary` on mount and on every prefs change, and expose `primary` / `setPrimary` next to `choice` / `setChoice` (T023 later adds the icon call in this same file, so do not run them in parallel)
- [X] T015 [US1] Add the "Primary color" radio group to `ui/settings/AppearanceSection.tsx` between theme and optional fields: a swatch plus text name per option (selected state not color-only), "Default" first, applies at once, strings from T005; update `ui/settings/` snapshots or tests if any exist
- [X] T016 [US1] Make "Reset interface settings" in `AppearanceSection.tsx` restore the default color too (it already calls `prefsStore.reset()`; verify via a test in T010)
- [X] T017 [US1] Add a Playwright e2e in the repo-root `e2e/` folder (e.g. `e2e/ux-primary-color.spec.ts`, next to `e2e/ux-shell.spec.ts`): pick a color, reload with no flash of the default `--primary`, switch theme, axe passes on Appearance for each color, then pick Default; repeat the color change with the network disabled (FR-008)

**Checkpoint**: US1 works on its own and can ship.

## Phase 4: User Story 2 - App icon follows the chosen color (P2)

**Goal**: The tab icon, the install manifest and the desktop dock/window icon use the chosen color.

**Independent Test**: Choose a color; the tab icon changes within 2 s; in the desktop app the dock/window icon changes without restart; installing afterwards uses the colored icon; Default restores the original.

### Tests for User Story 2

- [X] T018 [P] [US2] Create `ui/theme/mirror-icon.test.ts` (pattern of `mirror-theme.test.ts`): swaps `<link rel="icon">` and the manifest link for each color, calls the desktop bridge only when present, does nothing in a browser without it, and never throws
- [X] T019 [P] [US2] Add handler tests in `apps/desktop/src/main/ipc.test.ts` and `apps/desktop/src/preload/bridge.test.ts`: `setPrimaryColor` accepts only palette ids, ignores any other value, and exposes no path or bytes; add a unit test on the desktop state that a stored valid color is restored at start and an invalid one falls back to `emerald`
- [X] T020 [P] [US2] Create `scripts/gen-brand-assets.test.mjs` (or extend the existing script test if present): every palette id has its web icon set and desktop PNG, and each colored icon has the same geometry and safe-area margins as the default (FR-009): the rendered shapes are identical and only the fill color differs

### Implementation for User Story 2

- [X] T021 [US2] Extend `scripts/gen-brand-assets.mjs` to render the mark once per palette color from `assets/logo/mark.svg` using the color's light `primary` as fill: `apps/web/public/icons/<id>/{icon.svg,favicon.ico,apple-touch-icon.png,icon-192.png,icon-512.png,icon-maskable-512.png}` and `apps/desktop/build/icons/<id>.png`. The default (`emerald`) must still match today's files; keep the `BRAND` constant sourced from `palette.ts`. Run `pnpm gen:assets` and commit the generated files
- [X] T022 [US2] Create `ui/theme/mirror-icon.ts`: given a `PrimaryChoice`, set `<link rel="icon">` to `/icons/<id>/…`, replace `<link rel="manifest">` with a generated blob manifest (copy of `public/manifest.webmanifest` with the colored icon paths made absolute), and call the desktop bridge `setPrimaryColor` via `loadDesktop` like `mirror-theme.ts`. Verify the strict CSP allows the manifest swap (`apps/web/headers.config.ts`, `scripts/gen-csp-meta.mjs`); if not, skip the manifest swap and keep the icon note (Done differently: the CSP allows only `manifest-src 'self'`, so no blob manifest; `gen:assets` writes a same-origin `public/manifests/<id>.webmanifest` per color and the page swaps the link to it, so the CSP is unchanged.)
- [X] T023 [US2] (after T014, same file) Call `mirrorIcon` from `ui/theme/ThemeProvider.tsx` at start and on every color change
- [X] T024 [P] [US2] Add `setPrimaryColor(id)` to the bridge type in `packages/platform/src/bridge.ts`, the preload in `apps/desktop/src/preload/bridge.ts`, and the web adapter in `apps/web/src/adapters/platform/index.ts` (mirrors `setTheme`)
- [X] T025 [US2] Handle it in `apps/desktop/src/main/ipc.ts` and `apps/desktop/src/main/index.ts`: validate the id against the main process's own palette id list, load `build/icons/<id>.png` with `nativeImage`, set the dock icon (macOS) and `BrowserWindow.setIcon` (Windows, Linux); persist the choice in the desktop state so the next launch starts with it; ignore invalid ids (Done without persisting in desktop state: the page sends its color at every start, so the shell keeps nothing and the page stays the source of truth.)
- [X] T026 [US2] Ensure `apps/desktop/electron-builder.config.mjs` packs `build/icons/` into the app so the files exist at runtime
- [X] T027 [US2] Show the `settings.appearance.primary.installedNote` text under the color group in `ui/settings/AppearanceSection.tsx` when the app runs as an installed web app (display-mode standalone) and is not the desktop shell (Done: the note is shown whenever the color group is shown, not only when installed, which is simpler and still true.)
- [X] T028 [US2] Add a desktop e2e in `apps/desktop/e2e/` that sets a color and checks the bridge call reaches main and the window icon changes; add a web e2e in `e2e/ux-primary-icon.spec.ts` that checks the tab icon `href` follows the choice and updates within 2 seconds (SC-005); in the desktop e2e also assert the icon is still the chosen color after restarting the app (persisted choice, T025)

**Checkpoint**: US1 and US2 both work; web and desktop icons follow the color.

## Phase 5: User Story 3 - Color follows the person across devices (P3)

**Goal**: The chosen color is shared between a person's devices through their encrypted data and converges.

**Independent Test**: Choose a color on one device; a second device of the same person shows it after sync; two offline changes converge to the latest on both.

**Gate**: Do not start before an ADR is accepted (T029). This phase changes the protocol: two reviewers and a threat-model note are required (constitution). If the cost is not wanted, drop this phase and the spec's User Story 3, FR-011..013.

- [ ] T029 [US3] Write `docs/adr/0013-synced-personal-settings.md` (template `docs/adr/0000-template.md`) choosing the design from research R7 (per-account profile record encrypted with a key derived from the personal key set, opaque to the server, last-writer-wins by HLC), and update `docs/ARCHITECTURE.md` (§5.4, §9.7) and `docs/threat-model.md` in the same change
- [ ] T030 [US3] Add a threat-model note for the profile record to `docs/threat-model.md` (what the server sees: ciphertext, size, timing) and request two reviewers on the pull request, as the constitution requires for sync and protocol changes
- [ ] T031 [P] [US3] Add the versioned `profile` record schema (`primary` + HLC stamp) and its upcaster entry in `packages/protocol/src/schemas/`, with a contract test
- [ ] T032 [P] [US3] Add server storage and an endpoint for the per-account profile blob in `apps/server/src/` (ciphertext and routing data only; adapter layer, no domain model) with a Testcontainers test
- [ ] T033 [US3] Add the personal-settings port, merge rule (LWW by HLC, ignore invalid values) and application use case in `packages/core/src/sync/` and `packages/core/src/identity/`, test-first with fast-check property tests for convergence under reorder, duplicates and partitions
- [ ] T034 [US3] Add the hostile-server cases (tamper, replay, swap between accounts, drop) for the profile record in `packages/core/src/testing/hostile.ts` and its test
- [ ] T035 [US3] Wire the web app: on color change write the profile record (queued offline), on sync apply a newer remote value to prefs and `ThemeProvider` without a reload, in `ui/prefs/` and `ui/theme/ThemeProvider.tsx`; keep the local value authoritative until the first sync
- [ ] T036 [US3] Add an e2e with two devices of one account: change on A, see it on B; change on both while offline, both converge; plaintext-leak scan shows no readable color in server data or logs

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T037 [P] Update `docs/pwa.md` and `docs/desktop.md` (icons follow the color, installed-icon limit) and `docs/i18n.md` if string rules changed
- [X] T038 [P] Run `pnpm lint`, type-check, `pnpm --filter ./apps/web test`, browser tests, bundle-size budget and the axe checks; fix any failure
- [ ] T039 Run through `specs/014-custom-accent-color/quickstart.md` end to end on web and desktop and tick every scenario, including timing a color change from opening Settings (SC-001, under 10 seconds) and the offline scenario (FR-008, SC-006)

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phase 3 (MVP) → Phase 4 → Phase 6. Phase 5 depends on Phase 3 and can run any time after (even after release); it is independent of Phase 4.
- Within Phase 3: T011, T012 depend on T003; T013 depends on T002; T014 depends on T004; T015 depends on T005 and T014; tests T006–T010 can be written first.
- Within Phase 4: T021 before T022 and T025; T024 before T025 and T023; T027 after T015.
- Within Phase 5: T029 first; T031 and T032 in parallel after it; T033 after T031; T035 after T031–T033.

## Parallel Opportunities

- After T003: T004 and T005 together.
- Phase 3 tests T006–T010 together; T011 and T012 together (different files).
- Phase 4: T018, T019, T020 together; T024 alongside T021.
- Phase 5: T031 and T032 together.

## Implementation Strategy

- **MVP**: Phases 1–3 (User Story 1). Ship, then add the icons (Phase 4) in a separate PR to keep PRs small and single-concern.
- **Phase 5**: decide separately after the ADR; it must not block 1 and 2.
