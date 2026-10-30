# Cashfold desktop app

The desktop app is the web app in its own window, for Windows, macOS and Linux. It adds no features and changes no data format: the same account works on the web and on the desktop, and the two sync like any two devices. Design: [ADR-0009](adr/0009-electron-desktop-shell.md) (the shell), [ADR-0010](adr/0010-update-signatures.md) (update signatures), [ARCHITECTURE.md §10.1](ARCHITECTURE.md), threat model ([Desktop shell](threat-model.md)), specification in `specs/003-desktop-apps-releases/`.

## How it is built

- `apps/desktop` is an Electron shell. It serves the static export of `apps/web`, unchanged, from the origin `app://cashfold`, with the response headers (content policy) that the web build already writes to `_headers`. Nothing is loaded from `file://`, and no local port is opened.
- The page is isolated: context isolation and the sandbox are on, there is no Node in the page, navigation away from the app and new windows are refused, webviews cannot be attached, and only two permissions are granted (persistent storage, platform authenticators). Electron fuses are set when the app is packaged (`pnpm --filter @cashfold/desktop exec node scripts/check-fuses.mjs` reads them).
- The only thing the page can reach in the shell is a small typed bridge (`@cashfold/platform`, the global `cashfoldDesktop`): version and build information, the data location, and the update flow. Every call is checked against strict schemas on both sides, and only the app's own page may call.
- The version has one source, the root `package.json` (written by the release process). `apps/desktop/package.json` stays `0.0.0`.
- `apps/desktop/src/main/identity.json` holds the app name and id, which are **frozen** once a release exists: Electron derives the data folder from the name, and the updater identifies the app by the id. `pnpm check:desktop-config` and `identity.test.ts` guard them.
- The shell's own log is in `<data folder>/logs/cashfold.log` (structured, rotated, and redacted by type: no paths, keys, or IPC payloads).

## Working on it

```bash
pnpm --filter @cashfold/web build                 # the shell packages the built web export
pnpm --filter @cashfold/desktop dev               # builds main and preload, then opens the app on that export
CASHFOLD_DEV_URL=http://localhost:3000 pnpm --filter @cashfold/desktop dev    # against `next dev` instead (ignored in a packaged app)

pnpm --filter @cashfold/desktop test              # unit tests
pnpm --filter @cashfold/desktop test:packaged     # packages an unpacked app for this machine and runs the end-to-end tests against it
pnpm --filter @cashfold/desktop test:sync         # web and desktop on one account through a local relay (rebuilds the web export for it)
pnpm --filter @cashfold/desktop test:update       # the update flow against a local feed (a test build; downloads run on Windows and Linux)
pnpm --filter @cashfold/desktop package -- --mac --arm64     # installers into apps/desktop/release (nothing is published)
```

If the app starts and immediately fails with `Cannot read properties of undefined (reading 'commandLine')`, the environment variable `ELECTRON_RUN_AS_NODE` is set (editors and tools that are Electron apps themselves set it). The scripts and tests remove it; remove it from your own shell when starting Electron by hand.

## Where the data lives

The encrypted database, the key store and the app's settings live in Electron's user-data folder, the operating system's standard per-user application-data location. The folder is shown in Settings → Advanced → About, with a button that opens it. It is fixed (not user-configurable). Before opening it the app checks that it can write there; if it cannot (a read-only folder or volume), the app says so and stops instead of losing the session's work.

| System  | Folder                                                |
| ------- | ----------------------------------------------------- |
| Windows | `%APPDATA%\Cashfold`                                  |
| macOS   | `~/Library/Application Support/Cashfold`              |
| Linux   | `~/.config/Cashfold` (or `$XDG_CONFIG_HOME/Cashfold`) |

Uninstalling keeps this folder. The Windows uninstaller asks whether to delete it too (default No; an update or a silent uninstall never deletes it); on macOS and Linux remove the folder by hand. Back up with Settings → Data (an encrypted `.cashfold-backup` file, restorable only with the passphrase). Clearing a web browser's data does not touch the desktop app.

## Using your own relay

The desktop app talks to a relay from the page origin `app://cashfold`. A relay checks the origin of browser requests, so an operator who hosts their own must add it to `ALLOWED_ORIGINS`, next to the web app's address:

```text
ALLOWED_ORIGINS=https://cashfold.example.com,app://cashfold
```

## Known differences from the web app

| Difference                                                 | Why                                                                                              | What you see                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| "Use my location" when adding a transaction                | The shell grants no location permission (it would need a third-party location service).          | The button reports that location was denied. The place name and coordinates can still be typed.                                      |
| Quick unlock with a security key or platform authenticator | Depends on the operating system's support inside Electron; not yet checked on Windows and Linux. | The option is offered only where it works (the web app already feature-detects it). Record what each system does here when verified. |
| No offline-cache worker                                    | The files are local, so there is nothing to cache.                                               | Nothing; the app is as available offline as before.                                                                                  |
| Downloads go through a save dialog                         | The shell never writes a file without the person choosing where.                                 | Emergency Kit, backup, CSV export and attachment downloads open a "save as" dialog.                                                  |

## How the window behaves like an application

The shell, not the web app, makes the window feel native (spec 007), so the web app in a browser is unchanged.

- **No menu bar.** Windows and Linux show no menu (Alt shows nothing); macOS keeps only the menu named after the app (About, Hide, Quit). The keyboard shortcuts for the clipboard, undo, zoom, closing, minimising, full screen and quit are handled in `apps/desktop/src/main/shortcuts.ts`. About, update checks and the data folder are in Settings.
- **Shortcuts.** In the table, `Mod` is Command on macOS and Control elsewhere.

  | Shortcut                                                   | Action                                           |
  | ---------------------------------------------------------- | ------------------------------------------------ |
  | Mod+N                                                      | New transaction                                  |
  | Mod+L                                                      | Lock (works while locked)                        |
  | Mod+,                                                      | Settings                                         |
  | Mod+F                                                      | Search transactions                              |
  | Mod+K                                                      | Command palette (opens and closes it)            |
  | Mod+1 to Mod+5                                             | Overview, Transactions, Accounts, Plan, Settings |
  | Mod+Shift+I / Mod+Shift+E                                  | Import / export (Settings → Data)                |
  | Mod+W, Mod+M, Mod+Q (not macOS), F11 (Ctrl+Cmd+F on macOS) | Close, minimise, quit, full screen               |
  | Mod+plus, Mod+minus, Mod+0                                 | Zoom in, out, reset                              |

  While the app is locked every action except Lock is ignored, the command palette included. The table is `apps/desktop/src/main/shortcuts.ts`.

  **Command palette (spec 015).** Mod+K sends the page the `palette` action; the page toggles the palette (`apps/web/src/ui/palette/`). Unlike the other actions it does not close Help or the narrow-window drawer first, because the palette never opens over another dialog. In a browser the web app listens for Command+K (Apple systems) or Ctrl+K (others) itself, and Help shows that one shortcut there.

  **Help lists these.** Help in the sidebar opens a dialog that shows them, written the way the person's system writes them (spec 008). The list is `packages/platform/src/help-shortcuts.ts`; a test in `apps/desktop/src/main/help-shortcuts.test.ts` fails when it and the table disagree, so change both together. Redo is Shift+Mod+Z; reload and developer tools exist only in an unpackaged run and are not listed.

- **Interface text is not selectable.** Fields always are. A value a person has to copy or read out (a Secret Key, the details in About) must carry `data-selectable` in the web app, or the desktop app will not let it be selected. Add the attribute to any new such value.
- **Pointers.** The arrow on buttons, tabs, rows and disabled controls; the text pointer on fields and `data-selectable` values; the hand only on links that open a new window (`target="_blank"`).
- **Right-click** in a text field offers Cut, Copy, Paste and Select all (and spelling suggestions) in the app's language.

The rules are in `apps/desktop/src/main/native-feel.ts`.

## Presence, background, links and the frame

- **Count, tray and reminders.** While the app is unlocked, the dock icon (macOS) or taskbar button (Windows) shows how many scheduled entries wait for confirmation in the selected Fold, and reminders are shown by the system on any screen. A tray or menu-bar item offers Show, Add transaction, Lock and Quit; the macOS dock menu and the Windows jump list offer Add transaction and Lock, and up to five recent Folds while unlocked. Locking, in any way, clears the count and the Fold names at once. Nothing is shown while the app is locked.
- **Primary colour.** The page tells the shell the colour the person picked (a palette id, validated in the main process; no path or image crosses the bridge) and the shell sets the dock icon (macOS) or the window icon (Windows, Linux) from `build/icons/<colour>.png`. The page sends it at start, so the shell keeps nothing. The icon of the installed app in the launcher or installer, and the tray image, do not change.
- **Keep running in the background.** Settings → Desktop has "When I close the window": quit, or keep running. Closing then hides the window; the session, the idle time and the reminders go on, and Quit in the tray or menu bar quits. It is the default on macOS only, and is offered only where a tray or menu-bar icon can bring the app back. On Linux that means KDE, XFCE, Cinnamon, MATE, LXQt, Budgie, Pantheon and Deepin; plain GNOME has no tray without an extension, so closing quits there.
- **Start at login.** Off by default (Settings → Desktop). When on, the app starts locked and without a window, and waits in the tray or menu bar. Windows and macOS use the system's login item; Linux gets a standard autostart entry in `~/.config/autostart`. If the system refuses, the choice is kept and Settings says so.
- **Files and links.** Double-clicking a `.cashfold-backup` file opens Cashfold at the restore form with the file chosen. A `.csv` file can be opened with Cashfold ("Open with"); Cashfold never becomes the default CSV program. Dropping a CSV on the window starts the import; dropping a receipt on the open add sheet attaches it. `cashfold://add-device?email=…&server=…` opens the add-device screen with those two filled in and the Secret Key empty; `cashfold://open/<overview|transactions|accounts|plan|settings>` opens that screen. A link never carries a secret, and anything with one is refused. Nothing is imported, restored or signed in until you confirm. Details and limits: [the intake contract](../specs/006-native-desktop-experience/contracts/link-and-file-intake.md) and the [threat model](threat-model.md).
- **The window frame.** On macOS and Windows the title bar is a slim bar of the app's own window with the system's window buttons inside it; on Linux the system's title bar is kept. The sidebar uses the system's translucent material (macOS vibrancy, Windows 11 Mica) and goes plain when reduced transparency or high contrast is on. The bar's height is `--frame-bar-h` (40 px) in `apps/web/src/app/globals.css`; it is zero in a browser and on Linux, so the web layout is unchanged.
- **What is best effort on Linux.** The screen-lock event depends on the desktop (sleep and the idle poll are what is relied on); the tray depends on the desktop (above); the badge is not shown; start at login is an autostart entry.

## Installing

Take the installer for your system from the [releases page](https://github.com/cashfold/cashfold/releases/latest).

| System                                                                        | Format                                                 | Updates                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Windows 10 and later, 64-bit                                                  | `Cashfold-<version>-win-x64.exe` (installer, per user) | in the app                                            |
| macOS 12 and later (Apple silicon: `…-mac-arm64.dmg`; Intel: `…-mac-x64.dmg`) | disk image; drag to Applications                       | in the app once builds are signed; until then by hand |
| Linux, 64-bit                                                                 | `Cashfold-<version>-linux-x64.AppImage` (portable)     | in the app                                            |
| Linux, 64-bit                                                                 | `.deb` / `.rpm` packages                               | by hand: download the new package (the app tells you) |

The versions above are the targets; the floor is whatever the bundled Electron supports (record it in the table below when the first release is verified on each system).

**Unsigned builds.** Until the installers are code-signed, the release is labelled **UNSIGNED BUILD** and the system warns on first launch. macOS: open System Settings, then Privacy & Security, and choose Open Anyway next to the message about Cashfold (on macOS 14 and earlier you can instead Control-click the app and choose Open). Check the download against `SHA256SUMS` first. Windows SmartScreen: More info, then Run anyway. Linux AppImage: `chmod +x` the file, then run it. On Ubuntu 23.10 and later, an AppImage may need the sandbox allowed: run `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` (or add an AppArmor profile for the AppImage); the app keeps Chromium's sandbox on rather than shipping `--no-sandbox`.

**Check a download.** Every file is listed in `SHA256SUMS` (`sha256sum -c SHA256SUMS --ignore-missing`), and each has a build attestation: `gh attestation verify <file> --repo cashfold/cashfold`. The web export inside every installer is the one the release published: its tree digest is in the release notes and `BUILD_ID=<commit> node scripts/build-verify.mjs` reproduces it.

## Updating

The app looks for a new version when it starts and every few hours (Settings → Advanced → Updates; it can be switched off, and a manual check always works). It never downloads or installs without being asked, in two steps: _Download_, then _Restart and update_ (the app locks first, so an update never meets a write in progress).

- **Windows installer, AppImage** (and the signed macOS app): updated in the app. Before the update can be installed, the app checks the Cashfold project's signature on exactly the file it downloaded ([ADR-0010](adr/0010-update-signatures.md)); if the signature is missing or wrong, the file is deleted and nothing is installed.
- **`.deb`, `.rpm`, and the unsigned macOS app**: the app tells you a new version exists and opens the release page; install it as you installed the first one.
- Offline, or if GitHub cannot be reached, the check ends quietly in an "offline" message and everything else keeps working.

## Releasing

Releases are made by merging the **release proposal** (a pull request that a bot keeps up to date with the next version and the changelog), never by hand; see [repo-settings.md](repo-settings.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) for how titles decide the version. Merging it makes the tag `vX.Y.Z` and a draft release; the tag starts `release.yml`:

1. **gates**: the tag is a version tag of this commit and `package.json` says that version; the external security review is complete (`docs/security-review/status.md`); typecheck, lint, tests, licences, no-float, desktop configuration, third-party notices, audit.
2. **web**: two clean builds must be identical; bundle budgets; the export is packaged.
3. **desktop**: Windows, macOS and Linux installers are built and the _packaged_ app is tested on each (end-to-end tests, plaintext scan, fuses).
4. **publish**: the installers that update themselves are signed with the update key, the checksums and SBOM are written, provenance is attested, everything is uploaded to the **draft**, the release is checked for completeness, and only then made public. If anything failed earlier, nothing is public and an issue `Release vX.Y.Z failed` is opened; fix the cause and run the Release workflow again on the tag.

A re-run of the same tag cannot publish twice. The tag-to-published time is written to the run summary (target: under 45 minutes).

## Signing and secrets

| Secret / variable                                                                                                          | Where                                         | What it is                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RELEASE_APP_ID`, `RELEASE_APP_PRIVATE_KEY`                                                                                | environment `release-proposal` (no reviewers) | The GitHub App that makes the release proposal and the tag.                                                                                                                                                                      |
| `UPDATE_SIGNING_KEY`                                                                                                       | environment `release`                         | Ed25519 private key for update signatures, base64 PKCS#8. Also kept in an offline backup by a second person.                                                                                                                     |
| `APPLE_CERT_P12`, `APPLE_CERT_PASSWORD`                                                                                    | environment `release`                         | The Developer ID Application certificate (base64) and its password.                                                                                                                                                              |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`                                                                    | environment `release`                         | An App Store Connect API key, for notarization.                                                                                                                                                                                  |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                                                                                     | environment `release`                         | Windows certificate file route (`WINDOWS_SIGNING=pfx`).                                                                                                                                                                          |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and variables `AZURE_TRUSTED_SIGNING_ENDPOINT/ACCOUNT/PROFILE` | environment `release`                         | Azure Trusted Signing route (`WINDOWS_SIGNING=azure`).                                                                                                                                                                           |
| `WINDOWS_SIGNING` (variable)                                                                                               | repository                                    | `azure`, `pfx` or `none`.                                                                                                                                                                                                        |
| `RELEASE_SIGN` (variable)                                                                                                  | repository                                    | `true` turns signing on for releases. While it is not `true`, installers are built unsigned and the release is labelled so. With `WINDOWS_SIGNING=none`, Windows stays unsigned and the release is labelled unsigned as a whole. |
| `LOG_MASKING_CANARY`                                                                                                       | repository secret                             | A throwaway value, to check that logs are masked.                                                                                                                                                                                |

**Make the update key** (once, offline):

```bash
openssl genpkey -algorithm ed25519 -out update-key.pem
openssl pkey -in update-key.pem -outform DER | base64 | tr -d '\n'                    # the value of UPDATE_SIGNING_KEY
openssl pkey -in update-key.pem -pubout -outform DER | tail -c 32 | base64            # the public key: put it in apps/desktop/src/main/identity.json (updatePublicKeys)
```

Store the private key in the `release` environment and in an offline backup held by a second person, then delete the file. **Rotation:** add the new public key to `updatePublicKeys` (at most two are allowed), ship a release signed with the _old_ key, switch `UPDATE_SIGNING_KEY` to the new one, and remove the old public key one release later. Losing the key without a rotation strands installed copies (they would reject every update), so the backup is not optional. A release configuration with no public key is refused by `pnpm check:desktop-config`.

**Before signing is switched on:** the Apple Developer Program account and the Windows route are the owner's decisions (see the research notes R-D-14); `scripts/check-signing-env.mjs` stops a signing run that lacks any credential or has an expired certificate, and after the first signed run, check the logs with `SECRETS_TO_CHECK="APPLE_CERT_PASSWORD …" node scripts/check-run-logs.mjs <run id>`.

## Verified on

Results of `pnpm --filter @cashfold/desktop test:packaged` (the packaged app) and the checks of the go/no-go (quickstart section 2).

| System                                                     | Electron | Result                                                                                                                                                                                                                                                                                                                                                                                                                                            | Date       |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| macOS 26.5 (Apple silicon)                                 | 45.0.0   | packaged app: 26 end-to-end checks pass (encrypted database and restart, persistent storage, offline start, headers, isolation, fuses, plaintext scan of the data folder, single instance, encrypted backup and restore, abrupt kill, damaged database, About and its accessibility); web ⇄ desktop sync: pass; update offer, consent, notice, automatic-check switch and offline state: pass; the Windows installer builds from the same sources | 2026-10-22 |
| Performance, macOS 26.5 Apple silicon, 50,000 transactions | 45.0.0   | cold start to the sign-in screen 0.4 s (budget 3 s). Unlock 2.3 s, dashboard 4.3 s, adding a transaction 2.4 s at full speed; the same checks in plain Chromium on this machine give 2.3 s, 5.8 s and 3.4 s, so the shell is not slower than the web app. Both miss the 2 s and 200 ms budgets of spec 001 on this machine; see the note below.                                                                                                   | 2026-10-22 |
| Windows 10/11 x64                                          |          | not yet run (CI: `desktop-build.yml`)                                                                                                                                                                                                                                                                                                                                                                                                             |            |
| Linux x64 (latest Ubuntu)                                  |          | not yet run (CI: `desktop-build.yml`; the Chromium sandbox on Ubuntu 23.10 and later needs the setuid helper or an AppArmor allowance)                                                                                                                                                                                                                                                                                                            |            |
| Update download and verification (Windows, Linux)          |          | not yet run (`pnpm --filter @cashfold/desktop test:update` on those systems)                                                                                                                                                                                                                                                                                                                                                                      |            |
| Operating system floor                                     |          | whatever Electron 45 supports; record the published floor here and update the specification's assumption (Windows 10+, macOS 12+) if it differs                                                                                                                                                                                                                                                                                                   |            |

**Found while measuring (not caused by the shell).** With 50,000 transactions, pressing _Unlock_ at once after _Lock_ loses the unlock call: the old Core Worker is still closing the database, so the page's call goes to a worker that is about to end, and the unlock fails after the 60-second limit with "The app could not be unlocked. Try again." Waiting a few seconds first, or trying again, works. The web app does the same (`e2e/bench/dashboard-50k.spec.ts` fails at this step in plain Chromium on the same machine), so it is a bug in the web app's lock/unlock sequence (`apps/web/src/ui/core/core-client.ts`, `apps/web/src/worker/runtime.ts`), not in the shell; the desktop benchmark waits five seconds after locking so that the rest can be measured.

## Troubleshooting

- _The app does not start; a message says the data folder is not writable._ Fix the permissions or the read-only volume of the folder named in the message, then start again; nothing was changed.
- _The app starts but the window never appears (Linux)._ Run it from a terminal and read the output; on Ubuntu 23.10 and later see the sandbox note above.
- _An update fails with "could not be verified"._ The download was deleted and nothing was installed. Try again later; if it keeps happening, install the new version from the release page and report it, because the file or its signature on the release is wrong.
- _"Cannot reach the update service"._ You are offline or GitHub is not reachable; nothing else is affected.
- _A relay refuses the desktop app._ Add `app://cashfold` to its `ALLOWED_ORIGINS`.
- _Where is the log?_ `<data folder>/logs/cashfold.log`; it contains no paths, keys or data.
