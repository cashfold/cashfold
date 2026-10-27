# ADR-0012: The desktop app locks on system events, not on focus loss, and takes input from outside only for review

- **Status**: accepted
- **Date**: 2026-10-25
- **Decides**: `specs/006-native-desktop-experience` research D1 and D1b (lock policy) and D10 (what comes in from outside)

## Context

The web app hides its content as soon as the page is hidden or loses focus, and locks after a short hidden time (spec 001, FR-007). In a browser that is a sensible default. In the desktop app it is the most visible way the product feels foreign: clicking another window or the desktop covers the data, and a minimised window locks after a minute whatever idle time the person chose. The reason for the rule, though, is real: a person walks away and the data should not stay readable.

## Decision

In the desktop app:

1. **Losing focus does nothing by default.** It neither covers the content nor tells the session worker. A device-local setting, "Hide the content when I switch to another window" (off by default), restores the browser behaviour for people who want it.
2. **The computer's own events lock the app.** The shell reports the screen locking, the computer suspending, and the system reporting a locked state (polled every five seconds, sent once per change). The page locks exactly as its Lock button does. The shell sends the event again after a resume if the page has not reported `locked`, and clears everything it shows from app data on every such event.
3. **A hidden window is covered from view but does not start the one-minute timer.** The person's idle time governs it, and background throttling is off so the check runs on time.
4. **The shell never decides.** It reports facts; the page, which owns the session, locks. The shell holds no key. The page's `locked` or `unlocked` report is only a hint for what the shell's own surfaces may show.

The web app is unchanged. Spec 001 FR-007 carries a note that the desktop app amends it.

5. **What comes in from outside is only ever a request for review.** A `cashfold://` link, a CSV or a backup opened from the file manager, and the arguments of a second launch are parsed in the shell with a strict grammar and size limits (`apps/desktop/src/main/intake.ts`, `specs/006-native-desktop-experience/contracts/link-and-file-intake.md`) and handed to the page, which opens the matching screen. Nothing is imported, restored or signed in on arrival.
6. **A link never carries a secret.** It may carry an email address and a service address and nothing else; any secret-like parameter, key pattern, fragment, user information, port or double encoding refuses it. The Secret Key is typed on the add-device screen.
7. **A locked page never holds file contents.** The shell keeps them, in memory, until the page reports `unlocked`; links and refusals, which carry no content, are delivered as soon as the page can show them. The page drops queued contents when it locks.
8. **Cashfold is offered for CSV, never made the default.** It owns the `cashfold` scheme and its own backup extension, and is an alternative handler for `.csv`.

## Alternatives rejected

- **Keep the browser rule in the desktop app.** It is the reason the app feels foreign, and it protects against a case (looking away for a moment) that the idle time already covers.
- **Lock on focus loss with a longer delay.** Still surprising, and still wrong for a person working across windows.
- **Do the locking in the shell.** The shell would have to know about the session; keeping the decision in the page keeps the keys and the policy in one place.
- **Let a link carry the Secret Key to save typing.** A link is copied, logged, synced and shown in places no secret should be; the Secret Key stays out of it.
- **Act on an opened file at once.** A person opening a file did not necessarily mean to import it; review first, confirm after.

## Consequences

- A person who relied on the cover when switching windows must turn the setting on; the setting is in Settings → Desktop and described plainly.
- On Linux desktops that do not report the screen locking, the idle time is the safeguard; Settings → Desktop says so.
- Packaged tests simulate the events; the real system events are checked by hand (spec 006, verification V1 to V3).
- A file opened while the app is locked waits for the unlock; the person is not told until then, which keeps the locked screen free of anything about the file.
- The intake rules are security-sensitive: changes to `intake.ts` and to the registered protocol and file types need two reviewers and a threat-model note.
