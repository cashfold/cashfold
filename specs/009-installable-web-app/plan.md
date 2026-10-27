# Implementation Plan: Installable Web App (PWA)

**Branch**: `009-installable-web-app` | **Date**: 2026-10-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/009-installable-web-app/spec.md`

## Summary

The web app is already most of a PWA. The audit (research.md R0) found what exists and what does not, so this plan covers only the gaps:

1. **Update flow.** The worker, `register.ts` and the build already download a new version in the background, verify every file against its hash, and wait. `register.ts` announces it with a `cashfold:update-ready` event, but nothing in the app listens, so web users never learn of it and `applyUpdate` is never called. Add a pure update state machine, a quiet notice, a guard against losing unsaved input, a periodic update check (an installed window rarely navigates), and a rule that every tab reloads after a switch.
2. **Install.** Nothing exists. Add an install state machine (early capture of `beforeinstallprompt`, display-mode detection, per-browser steps) and an "Install Cashfold" Settings group that appears only when it can help.
3. **App feel.** Complete the manifest (id, shortcuts, categories, language, description, display override, colours) and check the first frame in dark.
4. **Offline proof.** The precache and its test cover the app shell. Add tests for the cases the spec promises that are untested: an unknown address offline, a direct address of every section, and an interrupted update.
5. **Persistent storage.** Already requested and reported. Re-request after install and test the wording.

Nothing changes in `core`, `crypto`, `protocol`, the server, the CSP or the desktop app. No new dependency.

## Technical Context

**Language/Version**: TypeScript (strict), Next.js static export (`apps/web`), the worker bundled by esbuild (`scripts/build-sw.mjs`).

**Primary Dependencies**: Existing only: React, the kit (`Notice`, `Button`), `useDesktop`, the i18n catalogue. No new dependency.

**Storage**: N/A. The only state is in memory; the dismissal of an update notice lasts for the page's life (spec: not again until the app is next opened).

**Testing**: Vitest (state machines, manifest contract, worker core); Playwright on Chromium and Firefox (offline, update with typed input, notice, install section hiding, axe in both themes); the update test uses a route override of `/sw.js` with another baked version (research R3).

**Target Platform**: Browsers: Chrome and Edge (desktop and Android) install on request; Safari on iPhone, iPad and Mac installs by steps; Firefox on desktop cannot install. The desktop (Electron) app is untouched.

**Project Type**: web app (static export) with a service worker.

**Performance Goals**: The install capture adds one small listener at start. The update check runs at most once an hour and on return to the app. No effect on first paint (the theme bootstrap is unchanged).

**Constraints**: CSP unchanged (`script-src 'self'`, no inline script, `manifest-src 'self'`, `worker-src 'self'`); the worker serves only the app's own files and no user data (R-22); nothing stored, synced or sent changes (FR-013); nothing install-related appears without the person asking (FR-003).

**Scale/Scope**: about 8 new source files, 1 settings group, 1 notice, 20 to 25 message keys x 3 languages, a larger manifest, ~6 new e2e tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Result |
|---|---|
| I Zero-Knowledge | Pass. No data is read or sent. The worker still caches only the hashed app files. |
| II, IV, V, VI | Not affected. |
| III Hexagonal | Pass. Presentation and browser adapters only; the state machines are pure; no change to `core`. |
| VII Local-First | Pass, and strengthened: offline behaviour gains tests. |
| VIII Security hygiene | Pass. No third-party script, no inline script, CSP unchanged, SRI unchanged. The manifest holds no secret. A shortcut URL carries no data. Update bytes are verified by SHA-256 before use (already so). |
| IX Simplicity | Pass. No library for install or update; two small state machines. The unsaved-input guard reads the DOM instead of requiring every form to register (research R4). |
| Technology constraints | Pass. Next.js client-only static export; worker bundled as before. |
| Quality gates | Test-first for the state machines; Playwright for each P1 story; axe (WCAG 2.2 AA) light and dark; i18n parity en, uk, pl. A Lighthouse installability check is added only if the repo's CI time allows (research R9). |
| Dev workflow | Accessibility and i18n in done. Commit messages carry no AI attribution. A change to what the worker caches or to the CSP needs a threat-model note: none is made. |

Post-design re-check: still passes; no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/009-installable-web-app/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── manifest.md
│   ├── update-messages.md
│   └── install-section.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/
├── public/manifest.webmanifest        # completed (id, shortcuts, categories, lang, dir, description, display_override, colours)
├── src/sw/
│   ├── register.ts                    # + periodic update check, a controllerchange handler for every tab, a typed message channel
│   ├── update-state.ts                # NEW pure state machine (+ test)
│   ├── service-worker.ts              # unchanged behaviour; message type for "version" (+ test in core.test.ts)
│   └── core.ts                        # unchanged
├── src/ui/pwa/
│   ├── install-state.ts               # NEW pure install state machine (+ test)
│   ├── install-capture.ts             # NEW early listener for beforeinstallprompt / appinstalled (+ test)
│   ├── unsaved-input.ts               # NEW DOM check for unsaved input (+ test)
│   ├── useUpdate.ts, useInstall.ts    # NEW hooks over the machines
│   └── WebUpdateNotice.tsx            # NEW; the desktop's notice keeps its name and file (shell/UpdateNotice.tsx)
├── src/ui/settings/InstallSection.tsx # NEW group "Install" in Settings, shown only when useful
├── src/ui/shell/{routes.ts,AppShell.tsx}  # group added; notice mounted next to the other banners
├── src/ui/i18n/messages/{en,uk,pl}.json   # new keys
└── e2e/
    ├── pwa-offline.spec.ts            # NEW unknown address, direct addresses, interrupted update
    ├── pwa-update.spec.ts             # NEW notice, typed input kept, other tab, failure
    └── pwa-install.spec.ts            # NEW section states, hidden in desktop and when installed, axe

docs/
└── (a short section in docs/ARCHITECTURE.md or a new docs/pwa.md for the update and install rules)
```

**Structure Decision**: all code is in `apps/web`. The worker keeps its job (serve the app shell, nothing else); the page owns every decision. The state machines are pure so they test without a browser.

## Complexity Tracking

No violations.
