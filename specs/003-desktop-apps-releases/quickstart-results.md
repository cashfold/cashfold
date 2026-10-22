# Quickstart results: desktop apps and automated releases

What has actually been run, where, and what has not. Written during implementation on 2026-10-22; update it as the remaining checks are done. Section numbers are those of [quickstart.md](quickstart.md).

## Run (macOS 26.5, Apple silicon, Electron 45.0.0)

| Section | What | Result |
|---|---|---|
| 1 | Run from source (`pnpm --filter @cashfold/desktop dev`); app on `app://cashfold`, no policy violations | pass |
| 2 items 1-4 | Packaged app: encrypted database opens and survives a restart; persistent storage granted; offline start; WebAssembly (Argon2, SRP, SQLite) loads | pass |
| 2 items 6-10 | Sandbox on; fuses set; navigation, `window.open`, webview refused; plaintext scan of the data folder; cross-device sync web ⇄ desktop; single instance | pass |
| 2 item 5 | Quick unlock (WebAuthn PRF) under Electron | not checked (needs a hardware authenticator); the web code feature-detects it |
| 3 | About: version, build, data folder, "Show in folder", source link, unsigned label | pass |
| 4 | Encrypted backup (nothing readable in the file), restore on a clean installation, wrong passphrase refused | pass |
| 4 | Uninstall keeps data / Windows uninstaller question | NSIS installer compiles with the question; **not run** |
| 8 | Update offer, nothing downloaded before consent, "up to date", offline state, notice (axe-clean), automatic-check switch (B-8), choice kept after restart | pass (local feed, macOS) |
| 8 | Download, signature check, tampered / missing / stranger / wrong-file signatures, corrupted download | **not run** on macOS (the real download needs an app signed by Apple); the logic is covered by 40 unit tests of the update flow and 18 of the signature scheme (RFC 8032 vectors) |
| 5-6 | Release proposal rules; all-or-nothing publish; tag ruleset | static checks only (workflow tests, config tests); **not run** on GitHub |
| 9 | Signing, notarization, Gatekeeper | **not run** (needs the owner's accounts and secrets) |
| 10 | Performance in the shell | cold start 0.4 s; 50,000 transactions at the same speed as the web app on this machine (both miss spec 001's 2 s and 200 ms budgets here); see `docs/desktop.md` for the lock-then-unlock race found on the way |

## Not run

- Windows and Linux: everything in section 2 and the packaged downloads of section 8. `desktop-build.yml` and `desktop-smoke.yml` are written to run them on GitHub's runners; they have not been run.
- The scratch-repository release run (sections 5 and 6), the real-release update test, and the first public release.
- Everything that depends on the owner: the constitution amendment PR (T001), the GitHub App and environments (T004), signing enrolment (T005), the update-signing key (T006), the tag ruleset (T078) and the final release approval (T102).
