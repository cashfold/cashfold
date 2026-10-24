# Threat model

Security-sensitive changes (crypto, auth, sync, sharing) append a note under *Change notes*. This page is the document the external review starts from (`docs/security-review/`). The protocol is in [protocol.md](protocol.md) and [sync.md](sync.md); what the service can see is in [privacy.md](privacy.md).

## What is protected

| Asset | Where it lives | Protected by |
| --- | --- | --- |
| Financial content: amounts, dates, names, notes, attachments | On devices, as an encrypted database (SQLite3 Multiple Ciphers, ChaCha20/AES-GCM pages) and as sealed operations on the service | The Fold key (AES-256-GCM per operation, per attachment piece, per snapshot) |
| Fold keys, one per Fold and epoch | Wrapped under the database key on each device; as HPKE grants for each member on the service | Each member's account encryption key |
| Account keys (encryption and signing) | A key set sealed under the Account Unlock Key (AUK); unwrapped only in the Core Worker while unlocked | AUK = 2SKD(password, Secret Key, salt), stretched with Argon2id |
| Password, Secret Key, Recovery Key | The person; the Secret Key and Recovery Key also in the Emergency Kit | Never sent to the service; the Secret Key and Recovery Key are 130 and 256 bits of randomness |
| Device keys | The device, sealed under the Local Vault Key | Local password stretching; optionally a platform authenticator (quick unlock) |
| Membership and history scope | A signed, hash-chained log per Fold, and per-member checkpoints | Ed25519 signatures of the members; clients verify from the first entry |

## Who we defend against

1. **A curious or breached service.** Holds all ciphertext and routing data (privacy.md). Must not learn content, and must not be able to forge anything a client would accept as genuine. A stolen copy of its database must not allow offline guessing of passwords any faster than an attack on the key set itself, which also needs the Secret Key.
2. **A network attacker** on the path to the service. Sign-in is SRP-6a inside a counter-bound AEAD frame; a captured exchange yields nothing reusable, and replay and reordering are rejected.
3. **A malicious or compromised member of a shared Fold.** May write junk or lie in their own name, but cannot act above their role: authorisation is checked against the role in force at the operation's clock time, from the verified membership log. A removed member keeps what they already received, but a new key is made for the epoch after their removal.
4. **A thief with a locked device.** Sees an encrypted database. A stolen *unlocked* device is the user's session and is out of scope except that sensitive actions (export, deleting the account, changing credentials, the Emergency Kit) ask for the password again.
5. **A lost or reset device.** Removing it from the account signs it out, rotates nothing it holds for other accounts, and makes the device erase itself when it next reaches the service.

## What is out of scope

- An attacker who controls the person's running browser or operating system (malware, a malicious extension, a hostile OS) while the app is unlocked.
- Traffic analysis beyond the routing data in privacy.md.
- A member of a Fold who copies what they legitimately see.
- Loss of *all* of: the password, the Secret Key and the Recovery Key. By design the service cannot help.

## Trust boundaries

- **Page ⟷ Core Worker.** Secrets live only in the worker; the page receives results and, once, the Secret Key or a Recovery Key to show. Passwords cross as bytes and are wiped by the page straight after.
- **Device ⟷ service.** Untrusted for confidentiality and integrity of content, trusted only for availability and for ordering. Operations are signed by their device, so the service cannot invent or alter them. It *can* withhold, delay and replay; clients detect gaps (per-device sequence numbers) and duplicates (operation ids).
- **Static host ⟷ browser.** The web app's code is delivered by the host (see residual risk 2).

## Residual risks (documented, accepted)

1. **JavaScript cannot guarantee memory erasure.** `SecretBuf.wipe()` overwrites the bytes it controls and every key is held in a `SecretBuf`, but the engine may have copied them (garbage collection moves objects, JIT and string interning keep temporaries, the operating system may swap pages, `postMessage` structured clones create copies). Locking ends the worker, which discards its heap, and that is the strongest guarantee available. A memory dump taken *while unlocked* may contain keys; one taken after a lock should not, but we do not claim it cannot. Passwords handled as strings in the page (an input's value) cannot be wiped at all.
2. **Web code delivery is trusted.** Whoever serves the app can serve code that exfiltrates secrets at the moment of use. Mitigations: a strict Content-Security-Policy, subresource integrity for every script, no third-party scripts, a service worker that pins the asset set it first installed, reproducible builds with published hashes (`scripts/build-verify.mjs`), and self-hosting from a source you control. It is not removable in a browser; a signed desktop shell is the long-term answer. Treat the hosted app like any web-based password manager: you trust the operator's integrity at the time you load it.
3. **Local rollback is not detected.** The on-device database detects modified and relocated pages but not the restoration of an older consistent copy of the whole file (ADR-0002). It needs write access to the browser profile. The signed operation log and the service's sequence checks bound the damage.
4. **The database cipher library has not been independently audited** (ADR-0002).
5. **Sizes and timing are visible** (privacy.md). Padding is a possible later change.
6. **Other devices after a credential change** keep working locally with their old password until they next reach the service, which signs them out; they then need the new password. The changed account's data on those devices is not re-encrypted.
7. **A Secret Key rotation does not re-encrypt old data.** Records and Fold keys are unchanged; only the key set that wraps the account keys is replaced. Someone who captured the old key set *and* the old Secret Key and password can still open the old key set (but cannot get new sign-ins to work).
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

- *The main process.* It runs with the person's full rights, outside the page. It holds no key and no plaintext: it serves files, shows windows, applies a policy, talks to GitHub to find updates, and opens the data folder. The database key never leaves the page's worker.
- *The bridge* (`@cashfold/platform`, global `cashfoldDesktop`). The boundary between the page and the main process. Eight fixed calls; no path, address or command from the page is ever used; every argument and every answer is checked against a strict schema; the caller must be the app's own page.
- *The installers and the update path.* What the person runs, and what replaces it later.
- *The update-signing key* (ADR-0010) and the operating-system signing credentials.

**Threats and mitigations**

| Threat | Mitigation |
|---|---|
| Code in the page (a compromised dependency, an injected script) reaches the person's computer | Context isolation, sandbox, no Node in the page; navigation, new windows and webviews refused; two permissions granted; the bridge is the only way out and is narrow and validated. The page's content policy is the web build's (no inline script, Trusted Types). |
| A page from another origin calls the bridge | Every call checks the sender frame's address is the app origin; a refused call is logged without its content. |
| The page asks the shell to open or write somewhere | It cannot name a path or address. The data folder opened is the one main chose; external links go through an allow-list of the project's own repository; downloads are accepted only from `blob:` URLs the app made, and always through the native save dialog. |
| Local files served to the page are swapped, or a path escapes the export | The export is read-only inside the application archive, whose integrity is checked by a fuse; the URL-to-file mapping refuses `..`, encoded separators, NUL, other hosts and methods before touching the disk. |
| A hostile or tampered **update** is installed | The updater never downloads or installs without the person's two clicks. Every installer that updates itself carries the project's Ed25519 signature, checked in the main process against keys built into the app, over the file's own SHA-512, fetched from the same release at an address built from the pinned repository. A bad or missing signature deletes the download. Downloads whose feed entry points elsewhere are refused. Windows and signed macOS builds also have the operating system's check. The feed's own SHA-512 alone would prove integrity only. |
| A test convenience becomes an update-hijack switch | The local update feed and its key exist only in a build made with the test flag, which the release check refuses (`pnpm check:desktop-config --release` looks at the build flags and at the bundle). |
| The update-signing key is stolen | It lives only in the protected `release` environment (reviewers, tags `v*` only) and in an offline backup held by a second person. A thief could sign a malicious update; mitigations are custody, the operating-system signature that signed builds also carry (it would need the thief to have that too), the provenance attestation on release assets, and two-key rotation (publish a release trusting old and new, then retire the old key). Losing the key is not an attack but strands installed copies, hence the backup. |
| The operating-system signing credentials are stolen | Held only as encrypted secrets in the same environment; a signing run needs approval; certificates are checked for expiry before use; renewal and revocation are documented in `docs/desktop.md`. |
| A release is made without the project's approval | Releases come only from the release proposal, which needs the same reviews as any change; creating a `v*` tag is restricted to the release GitHub App; the release workflow refuses to run on anything but a version tag of the commit it builds whose `package.json` says that version; and it will not run until the external review is complete. |
| A secret leaks through a build log | Secrets are handed to steps through the environment, never on a command line; GitHub masks them; a canary run and `scripts/check-run-logs.mjs` search the logs of a signed run. |
| The data folder is read by another program on the computer | Out of scope, as for the web app on a shared profile: the database is encrypted at rest with the same key hierarchy; a program running as the person can also read the page's memory. The location is shown to the person. |
| The shell logs something sensitive | The shell's log redacts by type (paths, key-shaped values, URL credentials, bytes); IPC payloads are never logged. |

**Residual risks.** The update check reveals the app version and the person's address to GitHub (documented in `docs/privacy.md`; it can be switched off). Electron's Chromium needs regular security updates, and a copy that is not updated stays exposed to the browser engine's known flaws; updates are therefore on by default and a release is made for every Electron security release. The JavaScript memory-erasure limit of the web app applies unchanged. The desktop shell is part of the scope of the external security review.

