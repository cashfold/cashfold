# Implementation Plan: Local-Only Sign-Up

**Branch**: `010-local-only-signup` | **Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/010-local-only-signup/spec.md`

## Summary

Let a person create an account with no relay. Sign-up already builds everything on the device first and registers with a service last, so local-only is "skip the last step and remember that we did". The change is a third value for the stored registration state (`local`), an optional address in the sign-up use case and form, a "Local only" reading of the existing sync status, and a handful of screens that must stop assuming a service exists (Emergency Kit, sharing, Getting started). Connecting later reuses the existing `sync.enable` path, which already registers an account made offline and lets the sync engine publish existing data. No cryptography, protocol, server or storage-schema change. See [research.md](research.md) for the decisions and [contracts/local-only-account.md](contracts/local-only-account.md) for the call and copy changes.

## Technical Context

**Language/Version**: TypeScript (strict, `exactOptionalPropertyTypes`), Node 26 for tooling

**Primary Dependencies**: None new. Existing: Next.js static export + Tailwind (`apps/web`), the Catalyst-derived `ui/kit`, `@cashfold/core`

**Storage**: Existing IndexedDB credential record (`registration` gains a value, no migration); no change to the encrypted SQLite/OPFS data

**Testing**: Vitest (core and web), Playwright (`e2e/`, new `us10-local-only.spec.ts`), axe checks, plaintext-leak scan, catalogue-complete test for the three languages

**Target Platform**: Web (static export) and the Electron desktop shell, which loads the same export. No shell changes expected

**Project Type**: Web application with a desktop shell and an optional relay server (`apps/web`, `apps/desktop`, `apps/server`, `packages/*`)

**Performance Goals**: Sign-up is no slower than today: it does strictly less work (no registration request). No new polling or timers

**Constraints**: Zero requests to any service for a local-only account (SC-002); fully usable offline; no secret reaches logs or storage outside the sealed credentials; strict CSP unchanged

**Scale/Scope**: About 10 source files touched, 12 new message keys in 3 languages, 1 new e2e spec, 3 docs updated

## Constitution Check

*GATE: passed before research, re-checked after design.*

| # | Principle | Result |
|---|---|---|
| I | Zero-Knowledge by Construction | Pass. The change sends less to the service, never more. A local-only account sends nothing. |
| II | Domain-Driven Design in `core` | Pass. The change sits in Identity & Access (`createAccount`, `registerExisting`, `UserAccount`). Sync gets only a type widening. |
| III | Clean / Hexagonal | Pass. UI → worker call → core use case → existing ports. No new port, no adapter reaches inward. |
| IV | CQRS | Pass. `sync.status` and `storage.status` stay queries; no ledger command changes. |
| V | Event Sourcing adapted to CRDT | Pass. The operation log is untouched. On connect, the existing sync engine publishes the operations already in the log, which `registerExisting` was built for. Covered by an end-to-end check (SC-003). |
| VI | Exact Money | N/A. |
| VII | Local-First | Pass, and strengthened: no function depends on a service, and a local-only account never waits on one. |
| VIII | Security Hygiene | Pass. The password is wiped on every path (existing `Secret`). No secret in logs or URLs; the Emergency Kit loses a link rather than gaining data. No third-party script. Threat-model note added (see Documentation). |
| IX | Simplicity and YAGNI | Pass. One enum value, one optional field, one checkbox, one notice component. No new abstraction, so Complexity Tracking is empty. |

Workflow gates: no cryptography, protocol or wire-format change, so no ADR is required. The change touches sign-up and sync, so it needs a threat-model note and two reviewers. Accessibility and the three catalogues are part of done.

**Process note**: the constitution says commit and PR text MUST NOT contain AI-tool attribution. The session's tooling asks for attribution lines. Resolve this when committing; the project rule should win unless the owner says otherwise.

## Project Structure

### Documentation (this feature)

```text
specs/010-local-only-signup/
├── plan.md                         # This file
├── research.md                     # Phase 0
├── data-model.md                   # Phase 1
├── quickstart.md                   # Phase 1
├── contracts/
│   └── local-only-account.md       # Phase 1: worker calls, screen behaviour, message keys
├── checklists/requirements.md
└── tasks.md                        # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
packages/core/src/identity/
├── ports/index.ts                          # DeviceCredentials.registration: + 'local'
├── application/create-account.ts           # optional server; local branch; NewAccount.registration + 'local'
├── application/register-existing.ts        # optional `discoverable` input (default true); otherwise expected unchanged, proven by tests
└── domain/user-account.ts                  # server may be '' (documented)

apps/web/src/
├── worker/app-handlers.ts                  # createAccount args optional; startSync type; sync.status type; sync.enable passes `discoverable`
├── worker/sync-service.ts                  # registration param accepts 'local' (no new behaviour)
├── ui/auth/SignUpForm.tsx                  # the choice; hide address and discoverable when checked
├── ui/auth/SecretKeyScreen.tsx             # backup suggestion for local; kit without service
├── ui/emergency-kit/kit.ts                 # optional server: omit Service line and add-device link
├── ui/settings/ProfileSecurity.tsx         # no empty address or "Pending" for a local account
├── ui/settings/SyncSection.tsx             # local intro + connect form with address required
├── ui/sync/SyncIndicator.tsx               # "Local only" before any connection logic
├── ui/sync/useSyncStatus.ts                # registration type widened
├── ui/sharing/ (+ settings/FoldsAndSharing.tsx)  # RelayNeeded notice, controls disabled
├── ui/firstrun/checklist.ts, checklist-status.ts, FirstRunChecklist.tsx  # conditional backup step (also feeds Help)
└── ui/i18n/messages/{en,uk,pl}.json        # 12 keys

e2e/us10-local-only.spec.ts                 # new
docs/{privacy,threat-model,self-hosting}.md, apps/web/README.md   # updated
```

**Structure Decision**: Existing monorepo layout; every change sits in a file that already owns the behaviour. No new package, module or component directory. The only new files are the e2e spec and, if the sharing notice is shared by several screens, one small component beside the sharing screens.

## Phase 1 design notes

- **Order of work** (test-first, as the constitution requires for core): core use cases and their tests → worker types → sync status and indicator → sign-up form and kit → Settings → sharing and Getting started → messages in three languages → e2e → docs.
- **Risk 1, connect without data loss**: `registerExisting` was written for this, but only the pending case has been exercised. The e2e spec must create data while local, connect to a real test relay, and read it back on a second profile (SC-003). The relay stack tests in `tests/stack` can host the same check at a lower level.
- **Risk 2, an empty address leaking into a request**: the kit's `server=` parameter, `ratesSource(id.server)` and the sync identity all take the address. The e2e request capture (SC-002) and a unit test per call site guard against it.
- **Risk 3, privacy default at connect time**: `registerExisting` used to make every account discoverable by email. A local account never saw that choice, so connecting asks for it, unchecked by default (spec FR-008a, research D-3).
- **Risk 4, the shared checklist**: Getting started and Help read one definition. The backup step must be added there, not in the card, or the two will disagree. The existing `checklist.test.ts` pattern covers it.
- **Existing behaviour to keep**: the data-loss backup reminder (`decideBackupNag`) is unchanged; the spec's assumption was corrected to say so.

## Complexity Tracking

No constitution violations. Nothing to justify.
