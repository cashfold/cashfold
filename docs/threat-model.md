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
