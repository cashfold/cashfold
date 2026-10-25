# Research: Language Choice Only Where It Belongs

## R1 — What exists

- `LanguagePicker` is rendered in two places: `AppearanceSection.tsx` (Settings → Appearance) and, through `AuthLayout`'s `footer` slot, by `PlainShell` in `AppShell.tsx`. `PlainShell` wraps every page shown before sign-in: home, sign-up, sign-in/unlock, recover and add-device.
- `SignUpForm.tsx` has two steps in one component: the form, then the Secret Key screen once the account is created.
- The language itself is resolved in `I18nProvider` (saved choice, else browser, else English) and stored in the device-local `language` preference. Nothing about detection or storage needs to change.
- `language.spec.ts` and `shell.spec.ts` currently use the footer picker on the home page and on the unlock screen.

## R2 — Decisions

**D1. Where the sign-up control goes.** Decision: render `LanguagePicker` inside `SignUpForm`, in the form step only, as a small end-aligned control above the page heading. Rationale: it is the one moment the spec wants it, it needs no new component, and keeping it out of the Secret Key step matches the spec's assumption (that step has no control of its own). Alternatives: a field inside the form after the email (rejected: it looks like account data, and the language is not part of the account); keeping it in the shared shell and hiding it on all pages but sign-up with a route check (rejected: a route check inside the shell is the very coupling that put the picker on every page).

**D2. The unused layout slot.** Decision: remove the `footer` prop from `AuthLayout` once nothing passes it. Rationale: spec 004 added it only for this picker; leaving it invites the picker back (principle IX). Alternative: keep for later use (rejected: YAGNI).

**D3. Unlock and recover pages have no control.** Decision: as the spec says. The saved or detected language applies and Settings offers the change after sign-in. Risk noted in the spec: a person who chose a language they cannot read on a shared device cannot change it from the unlock page. Mitigation costs nothing: the unlock screen is the same layout in every language, Settings is reached by the same icons, and the browser's language is used when the choice is "Automatic". No code is added for it.

**D4. Behaviour that must not change.** The saved choice still beats the browser on every page, including those without a control; a choice made on the sign-up page of a person who leaves without creating an account still applies to the next pages they see; the desktop menu still follows the language shown (the `setLanguage` bridge call is driven by the provider, not by the picker).

**D5. Tests.** Decision: add an e2e that walks the pre-sign-in pages and the signed-in screens and counts language controls (exactly one on `/sign-up/`, none on `/`, `/sign-in/`, `/recover/`, `/add/`, none on signed-in screens except Settings → Appearance), which is SC-001. Existing steps that used the footer on the home page or the unlock screen change to the sign-up page; the "unlock screen keeps the language" step now asserts `html[lang]` and the absence of a control. The layout-direction check in `shell.spec.ts` that measures the picker's position moves to `/sign-up/`.

**D6. Documentation.** `docs/i18n.md` and the README say where the control is. Spec 004's FR-003 and Story 2 ("before sign-in") get a one-line note pointing to this spec, so the two do not contradict each other.

## Spec adjustments recommended

None: the spec already records the unlock-page trade-off as an assumption.
