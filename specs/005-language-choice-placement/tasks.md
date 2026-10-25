---

description: "Task list for the language control placement"
---

# Tasks: Language Choice Only Where It Belongs

**Input**: Design documents in `/specs/005-language-choice-placement/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: Included. The contract is checked by counting controls per route (SC-001), and existing steps that used the removed footer picker must change.

**Format**: `- [ ] T### [P?] [US?] Description with file path` — `[P]` = different files, no dependency on an unfinished task.

**Paths**: web code under `apps/web/src/ui/…`, e2e under `e2e/`, docs under `docs/` and `specs/`.

**Run notes**: one Playwright invocation at a time, with `--workers=3`; run it as `env -u ELECTRON_RUN_AS_NODE npx playwright test -c e2e/playwright.config.ts …`.

---

## Phase 1: Setup

No setup is needed: the picker, the `language` preference and the provider exist (spec 004) and nothing new is installed.

---

## Phase 2: Foundational

- [X] T001 Read the current state before changing it: confirm in `apps/web/src/ui/shell/AppShell.tsx` that `PlainShell` passes `<LanguagePicker id="language-footer" …>` through `AuthLayout`'s `footer` prop, and that `LanguagePicker` is otherwise rendered only in `apps/web/src/ui/settings/AppearanceSection.tsx` (`grep -rn LanguagePicker apps/web/src`); note any other use and stop to report it if there is one

**Checkpoint**: the two current placements are confirmed.

---

## Phase 3: User Story 1 — Pages show the right language without asking (P1) 🎯 MVP

**Goal**: The home, unlock/sign-in, recover and add-device pages show the saved or detected language and have no language control.

**Independent test**: With the browser set to Polish, `/`, `/sign-in/`, `/recover/` and `/add/` are in Polish and contain no `select[name="language"]`; with an unsupported browser language they are in English.

### Tests first

- [X] T002 [US1] In `e2e/language.spec.ts`, add a test "pages shown before sign-in show the language and offer no control" that, for browser locales `pl` and `uk` (use `test.use({ locale })` blocks) and for an unsupported one (`de`, expecting English), visits `/`, `/sign-in/`, `/recover/` and `/add/` and asserts `html[lang]` is the expected language, the page heading is visible, and `page.locator('select[name="language"]')` has count 0 on each. It fails now (the footer picker is there)
- [X] T003 [US1] In `e2e/language.spec.ts`, change "the choice beats the browser language, and the picker is the same on the unlock screen" (currently `page.goto('/')` then `getByLabel('Мова')` has value `uk`) to: choose `uk` on `/sign-up/`, go to `/`, and assert `html[lang]` is `uk` and there is no language control — so a saved choice still applies on a page without a control (FR-009); then open `/sign-up/` again and assert its control shows `uk` selected (a person who left sign-up without creating an account keeps the choice)

### Implementation

- [X] T004 [US1] In `apps/web/src/ui/shell/AppShell.tsx`, make `PlainShell` render `<AuthLayout>` without a `footer` and delete the now unused `LanguagePicker` import
- [X] T005 [US1] In `apps/web/src/ui/kit/auth-layout.tsx`, remove the `footer` prop and its wrapper `<div className="mt-8 flex justify-end">`, so `AuthLayout` is `({ children })` only (research D2; contract rule 2)

**Checkpoint**: no page before sign-in offers a control. The sign-up page has none either until T008, so do T008 next.

---

## Phase 4: User Story 2 — Choose another language while creating the account (P2)

**Goal**: The sign-up page offers the control; the choice applies at once, keeps typed input, survives a reload and sets the language of the Secret Key page and the starter names.

**Independent test**: With an English browser, open `/sign-up/`, type an email address, switch to Ukrainian: the page changes, the address stays, the control is present. Create the account: the Secret Key page and the signed-in app stay Ukrainian and the first Fold is "Особистий"; the Secret Key page has no control.

### Tests first

- [X] T006 [P] [US2] In `e2e/language.spec.ts`, extend the sign-up test ("before sign-in: the footer picker changes the page at once …"): rename it to say "the sign-up page", and after creating the account in a new test "the choice made on sign-up carries through account creation" assert, in order: exactly one `select[name="language"]` on `/sign-up/`; after `signUp(page, …)` the Secret Key step is in the chosen language (`page.getByTestId('secret-key')` visible, heading text from `messages/uk.json` key `secretkey.title`, "Збережіть свій Секретний ключ"), has no language control, and the starter Fold is `Особистий`
- [X] T007 [P] [US2] In `e2e/shell.spec.ts`, change "language and direction follow the browser locale …": keep the `html` `lang`/`dir` checks on `/`, and move the picker-position check to `await page.goto('/sign-up/')` (control at the inline end: right of centre in LTR, left of centre in RTL)

### Implementation

- [X] T008 [US2] In `apps/web/src/ui/auth/SignUpForm.tsx`, import `LanguagePicker` from `../i18n/LanguagePicker` and render `<div className="mb-4 flex justify-end"><LanguagePicker id="language-signup" className="max-w-56" /></div>` as the first child of the form-step `<div>` (above the `<h1>`), and not in the `created` branch that returns `<SecretKeyScreen …>` (research D1; contract rule 3)

**Checkpoint**: US1 and US2 both work; the control is on `/sign-up/` only.

---

## Phase 5: User Story 3 — Change the language later only in Settings (P3)

**Goal**: After sign-in the language is changed only in Settings → Appearance; no other signed-in screen, dialog or sheet offers it.

**Independent test**: Sign in, open Settings → Appearance, choose Polish: every screen changes and the choice survives a reload. Walk every other signed-in route and open the add sheet and one dialog: none has a control.

### Tests first

- [X] T009 [US3] In `e2e/language.spec.ts`, add "after sign-in only Settings → Appearance offers the control" (run for `chromium`, one test): sign up in English, then for each of Overview, Transactions, Accounts, Budgets, Goals, Schedules, Settings (profile), Categories, Folds, Data, Devices, Advanced assert `select[name="language"]` has count 0; open the add sheet from the sidebar and the add-account dialog and assert count 0 in each; open Appearance and assert count 1 (SC-001, contract rule 5)
- [X] T010 [US3] In `e2e/language.spec.ts`, change "in Settings after sign-in: the choice is remembered …": after `page.reload()` (which locks the app) assert `html[lang]` is `uk` and that there is no language control on the unlock page (contract rule 4; the old assertion `getByLabel('Мова')` has value `uk` goes away)

### Implementation

- [X] T011 [US3] Confirm no code change is needed (confirmed: T009 passes; no other control exists): `AppearanceSection.tsx` already renders the only signed-in control, and no sheet or dialog renders one (T009 proves it). If T009 finds another, remove it and add that file to this task

**Checkpoint**: all three stories hold.

---

## Phase 6: Polish and cross-cutting

- [X] T012 [P] Run `e2e/pseudo-walk.spec.ts` (project `pseudo`) and `e2e/a11y.spec.ts`; the walk's allowance for the language names (`option[lang]`) still covers the sign-up control; fix anything either reports
- [X] T013 [P] Update `docs/i18n.md` ("How a language is chosen"): the control is on the sign-up page and in Settings → Appearance only; other pages show the saved or detected language. Update the README "Languages" paragraph the same way (one sentence)
- [X] T014 [P] Add the note "Narrowed by spec 005: the control is offered on the sign-up page and in Settings only." to `specs/004-ukrainian-polish-languages/spec.md` at User Story 2 (its text and acceptance scenario 3, "the unlock or sign-up screen …"), at FR-003 and at SC-002 ("or from the sign-in screens"). Update the matching sentences in `specs/004-ukrainian-polish-languages/contracts/language-preference.md` ("Picker: … on every page before sign-in"), in `specs/004-ukrainian-polish-languages/research.md` D4 ("a compact picker in the footer of the pre-sign-in layout") and in `specs/004-ukrainian-polish-languages/quickstart.md` step 2 ("in the footer of the sign-up screen" becomes "on the sign-up screen")
- [X] T015 Run the whole check: `pnpm typecheck`, `npx eslint apps/web/src e2e`, `npx vitest run apps/web apps/desktop` (the desktop `ipc.test.ts` and `bridge.test.ts` must still pass: the menu follows the language shown, driven by the provider and not by the picker, FR-011), then Playwright with `--project=chromium --project=rtl --workers=3` on `e2e/language.spec.ts e2e/shell.spec.ts e2e/a11y.spec.ts e2e/ux-settings.spec.ts`, and `--project=pseudo` on `e2e/pseudo-walk.spec.ts`; walk `quickstart.md` by hand once (its automated parts were run; the by-hand walk is left to the reviewer), including the check that the way to change the language is found in at most 3 interactions from any signed-in screen (SC-005: menu or Settings, Appearance, the language field)

---

## Dependencies and order

- Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6.
- US1 removes the control everywhere; US2 puts it back on the sign-up page. Do T008 straight after T004 and T005 (they touch different files), so the sign-up page is never without a control for longer than a commit; if committing separately, commit T004, T005 and T008 together.
- Tests T002, T003, T006, T007, T009, T010 all edit `e2e/language.spec.ts` or `e2e/shell.spec.ts`: edit `language.spec.ts` in order T002, T003, T006, T009, T010 (one file), and `shell.spec.ts` (T007) in parallel.
- T012, T013, T014 are independent of each other.

## Parallel examples

- After Phase 2: T002 and T007 (different files).
- Phase 4: T006 and T007 together, then T008.
- Polish: T012, T013, T014 together.

## Implementation strategy

1. **MVP = T001–T008.** Three small edits (`AppShell.tsx`, `auth-layout.tsx`, `SignUpForm.tsx`) with the e2e changes that prove them. That already gives the exact end state: two places offer the control.
2. Then T009–T011 add the signed-in guarantee and prove nothing else renders the control.
3. Polish aligns the documents, spec 004 included, and runs everything once.

## Notes

- Commits for this feature follow the constitution's workflow rule: no AI-attribution or co-author lines.
- This is a small change; one commit for T004, T005 and T008, one for the e2e changes and one for the documents is enough.
