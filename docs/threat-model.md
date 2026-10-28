# Threat model

Security-sensitive changes (crypto, auth, sync, sharing) append a note under _Change notes_. This page is the document the external review starts from (`docs/security-review/`). The protocol is in [protocol.md](protocol.md) and [sync.md](sync.md); what the service can see is in [privacy.md](privacy.md).

## What is protected

| Asset                                                        | Where it lives                                                                                                                  | Protected by                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Financial content: amounts, dates, names, notes, attachments | On devices, as an encrypted database (SQLite3 Multiple Ciphers, ChaCha20/AES-GCM pages) and as sealed operations on the service | The Fold key (AES-256-GCM per operation, per attachment piece, per snapshot)                  |
| Fold keys, one per Fold and epoch                            | Wrapped under the database key on each device; as HPKE grants for each member on the service                                    | Each member's account encryption key                                                          |
| Account keys (encryption and signing)                        | A key set sealed under the Account Unlock Key (AUK); unwrapped only in the Core Worker while unlocked                           | AUK = 2SKD(password, Secret Key, salt), stretched with Argon2id                               |
| Password, Secret Key, Recovery Key                           | The person; the Secret Key and Recovery Key also in the Emergency Kit                                                           | Never sent to the service; the Secret Key and Recovery Key are 130 and 256 bits of randomness |
| Device keys                                                  | The device, sealed under the Local Vault Key                                                                                    | Local password stretching; optionally a platform authenticator (quick unlock)                 |
| Membership and history scope                                 | A signed, hash-chained log per Fold, and per-member checkpoints                                                                 | Ed25519 signatures of the members; clients verify from the first entry                        |

## Who we defend against

1. **A curious or breached service.** Holds all ciphertext and routing data (privacy.md). Must not learn content, and must not be able to forge anything a client would accept as genuine. A stolen copy of its database must not allow offline guessing of passwords any faster than an attack on the key set itself, which also needs the Secret Key.
2. **A network attacker** on the path to the service. Sign-in is SRP-6a inside a counter-bound AEAD frame; a captured exchange yields nothing reusable, and replay and reordering are rejected.
3. **A malicious or compromised member of a shared Fold.** May write junk or lie in their own name, but cannot act above their role: authorisation is checked against the role in force at the operation's clock time, from the verified membership log. A removed member keeps what they already received, but a new key is made for the epoch after their removal.
4. **A thief with a locked device.** Sees an encrypted database. A stolen _unlocked_ device is the user's session and is out of scope except that sensitive actions (export, deleting the account, changing credentials, the Emergency Kit) ask for the password again.
5. **A lost or reset device.** Removing it from the account signs it out, rotates nothing it holds for other accounts, and makes the device erase itself when it next reaches the service.

## What is out of scope

- An attacker who controls the person's running browser or operating system (malware, a malicious extension, a hostile OS) while the app is unlocked.
- Traffic analysis beyond the routing data in privacy.md.
- A member of a Fold who copies what they legitimately see.
- Loss of _all_ of: the password, the Secret Key and the Recovery Key. By design the service cannot help.

## Trust boundaries

- **Page ⟷ Core Worker.** Secrets live only in the worker; the page receives results and, once, the Secret Key or a Recovery Key to show. Passwords cross as bytes and are wiped by the page straight after.
- **Device ⟷ service.** Untrusted for confidentiality and integrity of content, trusted only for availability and for ordering. Operations are signed by their device, so the service cannot invent or alter them. It _can_ withhold, delay and replay; clients detect gaps (per-device sequence numbers) and duplicates (operation ids).
- **Static host ⟷ browser.** The web app's code is delivered by the host (see residual risk 2).

## Residual risks (documented, accepted)

1. **JavaScript cannot guarantee memory erasure.** `SecretBuf.wipe()` overwrites the bytes it controls and every key is held in a `SecretBuf`, but the engine may have copied them (garbage collection moves objects, JIT and string interning keep temporaries, the operating system may swap pages, `postMessage` structured clones create copies). Locking ends the worker, which discards its heap, and that is the strongest guarantee available. A memory dump taken _while unlocked_ may contain keys; one taken after a lock should not, but we do not claim it cannot. Passwords handled as strings in the page (an input's value) cannot be wiped at all.
2. **Web code delivery is trusted.** Whoever serves the app can serve code that exfiltrates secrets at the moment of use. Mitigations: a strict Content-Security-Policy, subresource integrity for every script, no third-party scripts, a service worker that pins the asset set it first installed, reproducible builds with published hashes (`scripts/build-verify.mjs`), and self-hosting from a source you control. It is not removable in a browser; a signed desktop shell is the long-term answer. Treat the hosted app like any web-based password manager: you trust the operator's integrity at the time you load it.
3. **Local rollback is not detected.** The on-device database detects modified and relocated pages but not the restoration of an older consistent copy of the whole file (ADR-0002). It needs write access to the browser profile. The signed operation log and the service's sequence checks bound the damage.
4. **The database cipher library has not been independently audited** (ADR-0002).
5. **Sizes and timing are visible** (privacy.md). Padding is a possible later change.
6. **Other devices after a credential change** keep working locally with their old password until they next reach the service, which signs them out; they then need the new password. The changed account's data on those devices is not re-encrypted.
7. **A Secret Key rotation does not re-encrypt old data.** Records and Fold keys are unchanged; only the key set that wraps the account keys is replaced. Someone who captured the old key set _and_ the old Secret Key and password can still open the old key set (but cannot get new sign-ins to work).
8. **Shared Folds do not move with the account.** Moving to another service moves private Folds; shared Folds stay until their members agree, because their signed membership entries can only be replayed by their authors.
9. **QR codes are shown but not scanned** (no camera access): a fingerprint is compared by reading or typing it. This removes a camera permission at the cost of a manual step.
10. **A snapshot carries no time.** A new device installs a snapshot only if its signer's member sees the whole history and has held the editor role, so a viewer or a member who joined with "from now on" history cannot supply one. An editor who has since been removed cannot be told from a current one, so that member, together with a service that is not honest, could serve a snapshot they signed (or altered) while they were an editor. Closing this needs a signed time in the snapshot format and a check of the signer's role at that time; it is a protocol change, left for a later version (internal security review, 2026-10, INT-5).

## Abuse and availability

- Sign-in failures back off per account and per address; unknown addresses get a keyed fake salt so existence is not revealed; the Recovery Key credential answers like an unknown address when it is not set.
- Lookup by email is limited, needs a verified session, and gives the same answer for unknown and hidden addresses.
- Operation size, batch size, attachment piece size and per-Fold attachment quota are enforced by the service.
- Inputs from files (CSV, backups) are parsed with hard size limits and are fuzzed (`*.fuzz.test.ts`).

## Change notes

Add: date, change, asset or boundary touched, attacker capability considered, mitigation.

- 2026-10: Recovery Key (second SRP credential; keys wrapped under a key derived from the Recovery Key, never sent). A device that is not registered yet may read the wrapped keys and set new credentials, because recovery is how it gets in; it can do nothing else.
- 2026-10: Attachments sealed per 64 KiB piece under a key derived from the Fold key and the attachment id; the last-piece marker in each piece's authenticated data detects truncation.
- 2026-10: Account deletion and service migration need a fresh proof of the password; deleting the old account is skipped while other devices remain on it, so they are not told to erase unsent changes.

## Interface layer (spec 002)

- **Vendored UI code.** `apps/web/src/ui/kit/` holds components derived from the Catalyst kit and Headless UI (MIT). They run in the same origin as the key material, so they are reviewed like any dependency: pinned versions, `pnpm audit` in CI, no network access of their own, and a Content-Security-Policy without `unsafe-inline`/`unsafe-eval` that the end-to-end suite watches for violations (`e2e/ux-csp.spec.ts`).
- **Preference store.** `localStorage` key `cashfold.ui` holds the theme, remembered choices (ids of the last account and categories only), collapsed sections and dismissed hints. It never holds names, amounts, e-mail addresses or notes; the plaintext-leak scan fails if it does or if any other `localStorage` key appears. It is device-local, never synced or exported, and can be reset in Settings → Appearance.
- **Overlays.** The privacy cover makes dialogs inert and hidden; locking unmounts them (see ADR-0008).

## Desktop shell (spec 003)

The desktop app is an Electron shell around the unchanged web export (ADR-0009). It adds a program on the person's computer that loads the web app, a small bridge between the two, an updater, and installers. The web app's own rules (zero knowledge, local encryption, strict content policy) are unchanged and apply inside the shell.

**New assets and boundaries**

- _The main process._ It runs with the person's full rights, outside the page. It holds no key and no plaintext: it serves files, shows windows, applies a policy, talks to GitHub to find updates, and opens the data folder. The database key never leaves the page's worker.
- _The bridge_ (`@cashfold/platform`, global `cashfoldDesktop`). The boundary between the page and the main process. Eight fixed calls; no path, address or command from the page is ever used; every argument and every answer is checked against a strict schema; the caller must be the app's own page.
- _The installers and the update path._ What the person runs, and what replaces it later.
- _The update-signing key_ (ADR-0010) and the operating-system signing credentials.

**Threats and mitigations**

| Threat                                                                                        | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Code in the page (a compromised dependency, an injected script) reaches the person's computer | Context isolation, sandbox, no Node in the page; navigation, new windows and webviews refused; two permissions granted; the bridge is the only way out and is narrow and validated. The page's content policy is the web build's (no inline script, Trusted Types).                                                                                                                                                                                                                                                                                                      |
| A page from another origin calls the bridge                                                   | Every call checks the sender frame's address is the app origin; a refused call is logged without its content.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| The page asks the shell to open or write somewhere                                            | It cannot name a path or address. The data folder opened is the one main chose; external links go through an allow-list of the project's own repository; downloads are accepted only from `blob:` URLs the app made, and always through the native save dialog.                                                                                                                                                                                                                                                                                                          |
| Local files served to the page are swapped, or a path escapes the export                      | The export is read-only inside the application archive, whose integrity is checked by a fuse; the URL-to-file mapping refuses `..`, encoded separators, NUL, other hosts and methods before touching the disk.                                                                                                                                                                                                                                                                                                                                                           |
| A hostile or tampered **update** is installed                                                 | The updater never downloads or installs without the person's two clicks. Every installer that updates itself carries the project's Ed25519 signature, checked in the main process against keys built into the app, over the file's own SHA-512, fetched from the same release at an address built from the pinned repository. A bad or missing signature deletes the download. Downloads whose feed entry points elsewhere are refused. Windows and signed macOS builds also have the operating system's check. The feed's own SHA-512 alone would prove integrity only. |
| A test convenience becomes an update-hijack switch                                            | The local update feed and its key exist only in a build made with the test flag, which the release check refuses (`pnpm check:desktop-config --release` looks at the build flags and at the bundle).                                                                                                                                                                                                                                                                                                                                                                     |
| The update-signing key is stolen                                                              | It lives only in the protected `release` environment (reviewers, tags `v*` only) and in an offline backup held by a second person. A thief could sign a malicious update; mitigations are custody, the operating-system signature that signed builds also carry (it would need the thief to have that too), the provenance attestation on release assets, and two-key rotation (publish a release trusting old and new, then retire the old key). Losing the key is not an attack but strands installed copies, hence the backup.                                        |
| The operating-system signing credentials are stolen                                           | Held only as encrypted secrets in the same environment; a signing run needs approval; certificates are checked for expiry before use; renewal and revocation are documented in `docs/desktop.md`.                                                                                                                                                                                                                                                                                                                                                                        |
| A release is made without the project's approval                                              | Releases come only from the release proposal, which needs the same reviews as any change; creating a `v*` tag is restricted to the release GitHub App; the release workflow refuses to run on anything but a version tag of the commit it builds whose `package.json` says that version; and it will not run until the external review is complete.                                                                                                                                                                                                                      |
| A secret leaks through a build log                                                            | Secrets are handed to steps through the environment, never on a command line; GitHub masks them; a canary run and `scripts/check-run-logs.mjs` search the logs of a signed run.                                                                                                                                                                                                                                                                                                                                                                                          |
| The data folder is read by another program on the computer                                    | Out of scope, as for the web app on a shared profile: the database is encrypted at rest with the same key hierarchy; a program running as the person can also read the page's memory. The location is shown to the person.                                                                                                                                                                                                                                                                                                                                               |
| The shell logs something sensitive                                                            | The shell's log redacts by type (paths, key-shaped values, URL credentials, bytes); IPC payloads are never logged.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Residual risks.** The update check reveals the app version and the person's address to GitHub (documented in `docs/privacy.md`; it can be switched off). Electron's Chromium needs regular security updates, and a copy that is not updated stays exposed to the browser engine's known flaws; updates are therefore on by default and a release is made for every Electron security release. The JavaScript memory-erasure limit of the web app applies unchanged. The desktop shell is part of the scope of the external security review.

## Desktop lock policy (spec 006)

The desktop app no longer treats losing focus as a reason to hide or lock. A browser tab is easy to leave on a shared screen, so the web app still hides its content the moment the tab is hidden or loses focus and starts short timers. A desktop window is a program the person works beside others, and covering it every time they click another window made it feel foreign. The lock policy (ADR-0012) changes as follows.

**What changes**

- Losing focus neither covers the content nor tells the session worker, unless the person turns on "Hide the content when I switch to another window" in Settings → Desktop. The setting is device-local and off by default.
- A hidden or minimised window is still covered from view, but it no longer starts the worker's one-minute hidden-window timer. It locks at the person's idle time, like any other window.
- The shell reports the computer locking its screen, going to sleep and, where the system reports it, being locked or idle. The page locks exactly as its Lock button does, and the shell clears everything it shows from app data (badge, tray and menu entries, recent Fold names).

**What compensates**

- The system events above cover the case the old rule was a stand-in for: the person walking away. A locked app shows nothing, holds no key, and needs the password.
- The idle time still applies to every window state, and the shell sets `backgroundThrottling` off so a hidden window checks the idle time on schedule.
- Settings → Desktop says which of these events this computer reports, so nothing is promised that the system will not deliver. On Linux the screen-lock event depends on the desktop; sleep and the idle poll are what is relied on there.

**What is still true**

- The shell holds no key and no plaintext. Its reports of the page's state (`locked` or `unlocked`) are a hint for its own surfaces; no secrecy decision rests on them.
- A person who shares a screen can turn on the hide-on-switch setting, and the web app keeps its stricter behaviour unchanged.
- Screenshots and recordings cannot be prevented, as for the web app.

| Threat                                                                 | Mitigation                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Someone looks at the screen while the person clicks away and leaves    | The idle time locks the window whether it is visible, hidden or minimised; the system lock, sleep and idle events lock at once; the hide-on-switch setting covers the content at once if turned on. |
| The system lock event is missed (no report on this desktop)            | The idle time still applies; the capability report in Settings → Desktop states plainly which events are expected.                                                                                  |
| The shell shows app data (names, counts) while the app is locked       | Badge, tray, menu and recent-Fold entries are cleared on a page lock report and on every system lock event, and are refused by the shell unless the last report was `unlocked`.                     |
| A page claims to be unlocked to make the shell show data it should not | The shell holds only counts and short Fold names pushed by the page itself; the claim reveals nothing the page did not already hold.                                                                |

## Input from outside the window (spec 006)

The desktop app accepts three things from outside: a `cashfold://` link, a file opened from the file manager (a CSV or a Cashfold backup), and the arguments of a second launch. All are untrusted. They are parsed in the shell (`apps/desktop/src/main/intake.ts`) with a strict grammar and size limits, and handed to the page only as a request to open a screen for the person to review. Nothing is imported, restored or signed in on arrival (ADR-0012).

**Links carry no secrets.** A link may carry an email address and a service address, neither of which is secret, and nothing else. It is refused if any parameter is named like a secret (`key`, `secret`, `pass`, `recover`, `token`), if anything in it matches a Secret Key (`C1-…`) or a Recovery Key (`R1-…`), if it has a fragment (the web add-device link keeps its secrets there, and this form must not), user information, a port, an unknown or repeated parameter, a malformed email or a service address that is not a plain `https` URL, or a value that was encoded twice. The person types the Secret Key on the add-device screen. A refused link is reported by reason code only; its text is never shown, logged or kept.

**Files are checked on the open descriptor, before they are read.** The shell opens the path the system gave it and checks that it is a regular file (not a directory, device or pipe, nor a link to one), of a known extension, not empty and within its limit (CSV 16 MiB, backup 128 MiB), and only then reads it. The page receives the file name only, never the directory.

**A locked page holds no file contents.** File contents wait in the shell's memory until the page reports `unlocked`, and are dropped on quit. Links and refusals carry no content and are delivered as soon as the page has a listener. When the app locks, the page drops any file contents still queued. At most eight items wait, and at most 256 MiB of file bytes are held; the oldest item is refused with a message beyond that.

**Nothing is registered with the system's recent items, and logs say little.** A log line records the kind, the decision and a reason code, never a link or a path. A link's values are never put in a window title, a notification, a tray or menu entry.

**CSV is offered, never taken.** Cashfold registers the `cashfold` scheme and owns its own backup type. It is registered for CSV as an alternative handler only, so it never becomes the person's default CSV program; `pnpm check:desktop-config` fails if that changes.

| Threat                                                                           | Mitigation                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A crafted link carries or collects a secret                                      | The grammar refuses secret-like names and key patterns anywhere; the link has no way to carry a Secret Key; double encoding and a fragment are refused.                      |
| A link or file makes the app do something without the person's say-so            | Arrival only opens a screen for review; importing, restoring and signing in need the person's own confirmation (and the backup passphrase).                                  |
| A malicious file path (device, pipe, huge file, symbolic link to somewhere else) | The descriptor is checked for a regular file and its size before any read; the extension and the limits are enforced; an unreadable or odd file is refused with a code.      |
| File contents sit in a locked page                                               | The shell holds them until `unlocked`; the page drops queued contents on a lock.                                                                                             |
| Someone fills the queue to exhaust memory                                        | At most eight items and 256 MiB of file bytes; beyond that the oldest is refused with a message.                                                                             |
| Another program sends a second launch with hostile arguments                     | Arguments are matched against the closed set of quick actions and the intake grammar; anything else is ignored. The shell takes no path, URL or command from them but those. |

## Local-only accounts (spec 010)

An account made with **Keep everything on this device for now** is stored under `registration: local`: the device holds the encrypted data and the keys, and no service is ever contacted until the person connects one.

**What this removes.** There is no service adversary for such an account: nothing is sent, so a malicious or compromised service has nothing to read, reorder or withhold, and an observer on the network sees no Cashfold traffic from the account.

**What it accepts.** Losing the device without an encrypted backup is total and permanent loss of the data, and a forgotten password cannot be recovered, because a Recovery Key is held by the service and changing the password needs one. Both are accepted. They are mitigated by a backup suggestion when the account is made, a Getting started step, the existing data-loss reminder (which already treats data held only on the device as the firm case), and plain wording on the Sync settings page.

**What stays the same.** The password, the Secret Key and the encrypted database are protected exactly as for any account, including on a lock. Connecting later changes only the stored registration, the address and the sealed credentials; the registration payload is built from the password and the Secret Key as for an account made offline, and the account is registered as not findable by email unless the person chooses otherwise.

| Threat                                                       | Mitigation                                                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A local-only account quietly starts talking to a service     | The sync service is told `local` and stays idle; rates refresh only after a connection; a browser test counts calls to the service and expects zero. |
| An empty address leaks into a link, a request or the kit     | The Emergency Kit builds no add-device link without an address; an end-to-end test watches every request that leaves the app's origin.               |
| Connecting makes the person findable by email without asking | Connecting asks, unticked by default, and registers as not findable otherwise.                                                                       |

## Signing out (spec 011)

Signing out erases this device's copy of the account so another can be used. It removes the database files (also truncated, so no stale ciphertext is left), the sealed credentials, the quick-unlock record and the account-tied lock settings, and resets the Fold-keyed interface preferences and the shown-reminders list. The lock policy, language and theme are the device's and stay.

**A half-finished erase.** A note is written first and removed last, and every step can be repeated, so a crash, a closed tab or a power cut is finished at the next start, before any call is answered. A half-erased account cannot be opened.

**The lock-screen path.** "Use a different account" needs the account's own email address, typed, and not the password, because the person may not have it. The worker checks the address, not the page. Anyone holding the device with the app locked can therefore wipe it, as they could by clearing the site's data in the browser or deleting the app's folder. This only destroys; it reveals nothing. It is accepted.

**Leaving the service.** Removing the device from the service's list is best effort with a short time limit. If it fails the device may stay listed, which is clutter and not a risk, because its credentials are gone. The worker does not report the resulting "device removed" event while signing out, so it cannot erase twice or tell the person something they did not do.

**Unsent changes.** With the service reachable, signing out sends them first; if that does not finish the person must accept losing them. A local-only account has no other copy and needs a typed confirmation and, where possible, a backup first.

| Threat                                                   | Mitigation                                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A sign-out is cut short and leaves an account that opens | The note is written first, every step repeats, and every worker call finishes a pending erase before it is answered        |
| Someone without the password wipes a locked device       | Accepted (above); it needs the typed email, it only destroys, and an account with no service is warned it is the only copy |
| A stale device stays on the service                      | Best-effort removal; the person is told; its credentials are gone                                                          |
| The next account inherits the last one's backup history  | The account-tied settings, recents and reminders are reset; an end-to-end test checks storage after sign-out               |
| Last changes are lost                                    | A final sync before erasing, and an explicit acceptance when it cannot finish                                              |
