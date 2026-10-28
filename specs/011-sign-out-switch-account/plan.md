# Implementation Plan: Sign Out and Switch Account

**Branch**: `011-sign-out-switch-account` | **Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/011-sign-out-switch-account/spec.md`

## Summary

Let a person leave the account on this device, so they can use another. The app already erases a device when it is removed from an account or after "Delete my account"; what is missing is a way to start that on purpose, with the right warnings, and the pieces around it. This plan adds a `signOut` use case in `core` (mark, leave the service if possible, erase, unmark), two worker calls (one for an unlocked app, one for the lock screen), one `SignedOut` event for all tabs, one confirmation dialog used in two places, and one shared signed-out screen. It also fixes what the existing erase leaves behind: the database from the lock screen, the account-tied device settings, the Fold-keyed preferences and the shown-reminders list. No cryptography, protocol, server or storage-schema change. See [research.md](research.md) for decisions and [contracts/sign-out.md](contracts/sign-out.md) for calls, event and copy.

## Technical Context

**Language/Version**: TypeScript (strict, `exactOptionalPropertyTypes`), Node 26 for tooling

**Primary Dependencies**: None new. Existing: Next.js static export + Tailwind (`apps/web`), the Catalyst-derived `ui/kit` (`Dialog`), `@cashfold/core`

**Storage**: OPFS pool `/cashfold` (erased), IndexedDB `cashfold-credentials` stores `device`, `quick`, `settings` (cleared or reset, plus one transient marker key in `device`), `localStorage` `cashfold.ui` and `cashfold.reminders.shown` (reset or removed). No schema change

**Testing**: Vitest (core and web), a real-browser scenario in `apps/web/src/adapters/sqlite-opfs/test-scenarios.ts`, Playwright (`e2e/us11-sign-out.spec.ts`), axe, the plaintext-leak scan, the catalogue-complete test

**Target Platform**: Web (static export) and the Electron shell, which loads the same export. No shell change expected

**Project Type**: Web application with a desktop shell and an optional relay (`apps/web`, `apps/desktop`, `apps/server`, `packages/*`)

**Performance Goals**: Sign-out finishes in under 2 seconds on a typical device, plus at most the short time limit for leaving the service (5 seconds)

**Constraints**: Works offline; no secret or email in logs; the erase is idempotent and finishes after a crash; nothing of the account remains (SC-003); strict CSP unchanged

**Scale/Scope**: About 12 source files touched, about 28 new message keys in 3 languages, 1 e2e spec, 1 real-browser scenario, 2 docs updated

## Constitution Check

_GATE: passed before research, re-checked after design._

| #    | Principle                      | Result                                                                                                                                                                                                                   |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I    | Zero-Knowledge by Construction | Pass. The only request is the existing device removal, which carries a device id. No key or email is sent, and the lock-screen path sends nothing.                                                                       |
| II   | Domain-Driven Design in `core` | Pass. The rules live in a use case in Identity & Access (`sign-out.ts`) behind ports, beside `delete-account.ts`.                                                                                                        |
| III  | Clean / Hexagonal              | Pass. UI → worker call → core use case → ports (marker, eraser, device removal, session). The adapters that touch OPFS, IndexedDB and `localStorage` stay in `apps/web`.                                                 |
| IV   | CQRS                           | Pass. Sign-out is a command with no ledger events; `status`, `sync.status` and `storage.status` stay queries. The one query that changes (`status`) finishes a pending erase first, which is recovery, not a read model. |
| V    | Event Sourcing adapted to CRDT | Pass. The operation log is erased with the database, never edited. Nothing replicated is changed or sent.                                                                                                                |
| VI   | Exact Money                    | N/A.                                                                                                                                                                                                                     |
| VII  | Local-First                    | Pass. Sign-out needs no network; leaving the service is best effort and never blocks.                                                                                                                                    |
| VIII | Security Hygiene               | Pass. Secrets are wiped on every path, nothing is written to logs, no third-party script. The new lock-screen path only destroys; its risk is recorded in the threat model.                                              |
| IX   | Simplicity and YAGNI           | Pass. One use case, one dialog, one screen component, one event. No multi-account support, no new store. Complexity Tracking is empty.                                                                                   |

Workflow gates: no cryptography, protocol or wire-format change, so no ADR. The change touches authentication and the sync session, so it needs a threat-model note (FR-018) and two reviewers. Accessibility and the three catalogues are part of done.

**Process note**: this branch is `010-local-only-signup`, which holds the previous feature. The 011 files are not committed. Create a branch for this feature before committing, and keep the commit text free of attribution lines, as for feature 010.

## Project Structure

### Documentation (this feature)

```text
specs/011-sign-out-switch-account/
├── plan.md                  # This file
├── research.md              # Phase 0
├── data-model.md            # Phase 1
├── quickstart.md            # Phase 1
├── contracts/
│   └── sign-out.md          # Phase 1: worker calls, event, screens, message keys
├── checklists/requirements.md
└── tasks.md                 # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
packages/core/src/identity/
├── ports/index.ts                      # + PendingEraseMarker, LocalEraser ports
├── application/sign-out.ts             # new: signOut, signOutLocked, finishPendingErase
├── application/sign-out.test.ts        # new
└── domain/device-settings.ts           # + resetAccountTied(settings)

apps/web/src/
├── adapters/keystore-idb/pending-erase.ts   # new: the marker, in the `device` store
├── adapters/local-erase.ts                  # new: unlink OPFS files, clear credentials and quick unlock, reset account-tied settings
├── worker/sign-out-guard.ts                 # new: makes the revoke's DeviceRemoved harmless while signing out
├── worker/app-handlers.ts                   # account.signOut, account.signOutLocked, finish on status, signingOut flag
├── worker/core-worker.ts                    # wire the eraser and the marker
├── ui/core/CoreProvider.tsx                 # handle SignedOut
├── ui/core/RequireUnlocked.tsx              # signed-out branch uses SignedOutChoices
├── app/page.tsx                             # same
├── ui/auth/SignedOutChoices.tsx             # new: three ways in
├── ui/auth/UnlockForm.tsx                   # "Use a different account"
├── ui/settings/SignOutSection.tsx           # new, on Profile and security
├── ui/settings/ProfileSecurity.tsx          # renders it
├── ui/auth/SignOutDialog.tsx                # new: one confirmation, two entries
├── ui/auth/sign-out-view.ts                 # new: pure view model for the dialog
├── ui/settings/DataAndStorage.tsx           # "Back to sign out" when ?then=sign-out
├── ui/settings/sign-out-return.ts           # new: reads ?then=sign-out
├── ui/prefs/ (reset helper)                 # resetAccountPrefs
└── ui/i18n/messages/{en,uk,pl}.json         # about 28 keys

e2e/us11-sign-out.spec.ts                    # new
e2e/fixtures/residue.ts                      # new: what the app left in storage
docs/{privacy,threat-model}.md               # updated
```

**Structure Decision**: Existing monorepo layout; every change sits in a file that already owns the behaviour, except the five new small files named above. No new package.

## Phase 1 design notes

- **Order of work** (test-first, as the constitution requires for core): the `signOut` use case with fakes → the marker and eraser adapters → worker handlers and the real-browser scenario → the `SignedOut` event and the signed-out screen → the dialog and its view model → the two entry points → messages in three languages → e2e → docs.
- **Risk 1, residue**: the spec's strongest promise is "nothing remains" (SC-003). The inventory in `data-model.md` came from reading the code; the leak scan in the e2e spec and the real-browser scenario must list the OPFS files, the three IndexedDB stores and both `localStorage` keys after sign-out, so a store added later is noticed.
- **Risk 2, the revoke race**: removing this device on the service makes the sync engine publish `DeviceRemoved`. The `signingOut` flag must stop that event from erasing a second time or showing the removed notice. A worker test covers it with a fake service that revokes.
- **Risk 3, a half-finished erase**: the marker is written first and removed last, and every step is safe to repeat. A test interrupts after each step and restarts. Every worker call, not only `status`, finishes a pending erase first.
- **Risk 3a, the order of the steps**: locking ends the worker and an open database blocks the unlink, so the order is: marker, leave the service, close the database, erase, publish `SignedOut`, clear the marker, and lock last. The real-browser scenario runs it with an open session.
- **Risk 4, the lock-screen wipe**: it needs no password, so the typed-email check must be inside the worker, not only in the page, and a wrong address must erase nothing.
- **Existing behaviour to keep**: "Delete my account" and the removal of a device keep working. Both call the same eraser, so they gain the fuller erase too.

## Complexity Tracking

No constitution violations. Nothing to justify.
