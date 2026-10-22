# ADR-0009: The desktop app is an Electron shell around the web export

- **Status**: accepted
- **Date**: 2026-10-22
- **Decides**: `specs/003-desktop-apps-releases` research R-D-01 to R-D-04, R-D-10; amends the constitution (v1.1.0)

## Context

People want to install Cashfold like a normal application on Windows, macOS and Linux and keep their data on their own machine (spec 003). The constitution (v1.0.1) named Tauri 2 as the planned desktop shell. The app depends on browser features that are only tested on Chromium: encrypted SQLite (SQLite3 Multiple Ciphers, WebAssembly) on OPFS through the SyncAccessHandle pool (ADR-0002), WebAuthn with PRF for quick unlock, Web Locks, and several WebAssembly modules (Argon2id, SRP).

## Decision

Ship **Electron** (apps/desktop), loading the built static export of `apps/web` unchanged.

- The export is served from the privileged scheme `app://cashfold` (secure, standard, fetch-capable), with the headers that `harden-html.mjs` already writes to `_headers`. No `file://`, no local HTTP port.
- One small, strictly validated bridge, defined in a new leaf package `@cashfold/platform` so that `apps/web` and `apps/desktop` never import each other: about info, data location, update state machine. No keychain, no file-export method (backup already exists and is encrypted).
- Context isolation, sandbox, no Node integration in the renderer, navigation and permission lockdown, Electron fuses.
- Updates only with the user's consent. Integrity comes from the feed's SHA-512; authenticity comes from a project Ed25519 signature checked in the app (ADR-0010). Formats that cannot self-update (deb, rpm, unsigned macOS) show how to update.
- The service worker is not registered in the desktop build: the files are local.

## Alternatives rejected

- **Tauri 2** (the constitution's earlier plan): smaller installers, but each operating system's webview differs, and WebKitGTK on Linux is the most likely to differ on OPFS access handles and WebAuthn, exactly the features this app depends on. It would also add a Rust toolchain next to a TypeScript-only repository.
- **PWA only**: installable in Chromium browsers, but data stays in browser storage that the browser can evict or the user can clear, which is the problem the feature exists to solve.
- **Loopback HTTP server inside the app**: opens a local port reachable by other processes.

## Consequences

- Installers are larger (about 100 MB) and Electron's Chromium needs regular security updates (a pinned version, upgraded by the dependency bot).
- Behaviour matches the Chromium-tested web build on all three operating systems.
- On Ubuntu 23.10 and later, restricted unprivileged user namespaces can stop Chromium's sandbox starting in an AppImage; the sandbox stays on and the setting is documented (`docs/desktop.md`).
- Quick unlock (WebAuthn PRF) may be unavailable on some operating systems under Electron; the web code feature-detects it, and any difference is documented, not worked around here.
- The constitution's Technology Constraints text changes from "Tauri 2" to Electron (version 1.1.0). Mobile shells are undecided.
- The desktop shell is a new attack surface (main process, preload, protocol handler, updater): it is in the threat model and in the external review scope, and its security-sensitive paths need two reviewers.
