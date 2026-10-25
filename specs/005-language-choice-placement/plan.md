# Implementation Plan: Language Choice Only Where It Belongs

**Branch**: `005-language-choice-placement` | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-language-choice-placement/spec.md`

## Summary

Move the language picker out of the shell shared by every page shown before sign-in and into the sign-up form, so that only two places offer it: sign-up and Settings → Appearance. Detection, the saved choice, translation and the desktop menu are untouched. The work is one component move, removal of an unused layout slot, and test and documentation changes. No data, protocol, core or server change.

## Technical Context

**Language/Version**: TypeScript (strict), React 19 / Next.js App Router static export

**Primary Dependencies**: none new; reuses `LanguagePicker`, the `language` preference and `I18nProvider` from spec 004

**Storage**: unchanged (device-local `language` preference)

**Testing**: Vitest (none needed beyond existing), Playwright (`language.spec.ts`, `shell.spec.ts`, `pseudo-walk.spec.ts`)

**Target Platform**: web and the Electron desktop app (same web bundle)

**Project Type**: web application with a desktop shell

**Performance Goals**: language switch on sign-up visible in under 1 s (unchanged from spec 004)

**Constraints**: no new bundle weight (the picker moves; nothing is added); no inline script; accessibility checks stay green

**Scale/Scope**: 3 source files touched (`AppShell.tsx`, `SignUpForm.tsx`, `auth-layout.tsx`), 2 e2e specs adjusted (`language.spec.ts`, `shell.spec.ts`; `pseudo-walk.spec.ts` only re-run), 6 doc files (`docs/i18n.md`, `README.md` and four files of spec 004)

All unknowns are settled in [research.md](research.md).

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1, still passed.*

| Principle | Result |
|-----------|--------|
| I Zero-knowledge | Pass. The choice stays on the device; nothing new reaches the service. |
| II–V DDD, hexagonal, CQRS, event sourcing | N/A. UI placement only; no domain, event or projection change. |
| VI Exact money | N/A. No money path touched. |
| VII Local-first | Pass. Everything is local and works offline as before. |
| VIII Security hygiene | Pass. No script, dependency or storage added. |
| IX Simplicity | Pass. Removes an unused layout slot (`footer`) rather than adding a layer. |
| Quality gates | Pass. Accessibility (axe) and e2e for the stories are kept; internationalisation stays in the definition of done. |

## Project Structure

### Documentation (this feature)

```text
specs/005-language-choice-placement/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── language-control-placement.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/src/ui/shell/AppShell.tsx        # PlainShell stops rendering the picker
apps/web/src/ui/kit/auth-layout.tsx       # remove the `footer` slot, now unused
apps/web/src/ui/auth/SignUpForm.tsx       # renders the picker on the form step only

e2e/language.spec.ts                      # pages without a control; control only on sign-up and Settings
e2e/shell.spec.ts                         # layout-direction check moves to the sign-up page
e2e/pseudo-walk.spec.ts                   # (unchanged; confirms no stray text)

docs/i18n.md                              # where the control is
specs/004-ukrainian-polish-languages/{spec.md,research.md,quickstart.md,contracts/language-preference.md}   # note where FR-003, Story 2 and SC-002 are narrowed by spec 005
README.md                                 # one sentence
```

**Structure Decision**: edit in place. `LanguagePicker`, the preference and the provider are reused as they are.

## Complexity Tracking

No constitution violations and no new abstraction.
