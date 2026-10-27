# Contract: links and files that come in from outside

Everything that reaches the app from outside (a `cashfold://` link, a file opened from the file manager, a dropped file, an argument of a second launch, a tray or dock quick action) is untrusted. Parsing and size checks happen in the shell (`apps/desktop/src/main/intake.ts`) for links, opened files and arguments, and in the page for dropped files, with the same rules. Nothing is acted on at arrival: an item only opens the matching screen for the person to review.

## `cashfold://` links

Accepted forms (everything else is refused):

```text
cashfold://add-device?email=<email>&server=<https URL>
cashfold://open/<target>        target: overview | transactions | accounts | plan | settings
```

Rules, all of which must hold:

1. Total length at most 2,048 characters; scheme `cashfold`; the host is `add-device` or `open`.
2. No fragment (`#…`), no user-information, no port on the scheme part. (The existing web add-device link keeps its secrets in the fragment; this form must not.)
3. Query parameters are only `email` and `server`, each at most once; any other name is refused.
4. `email`: at most 254 characters, one `@`, no control characters or whitespace.
5. `server`: an `https:` URL of at most 300 characters, with no user-information, no fragment and no control characters.
6. **No secrets.** A link is refused if any parameter name contains `key`, `secret`, `pass`, `recover` or `token` (case-insensitive), or if any part of the link matches a Secret Key (`C1-…`) or a Recovery Key (`R1-…`) pattern. The refusal message says that secrets are never sent in a link; the value is not logged, shown or kept.
7. Percent-decoding happens once, after the checks on the raw form; decoded values are checked again for control characters.

Handling: `add-device` opens the add-device screen with the email and service address filled and the Secret Key and password empty; `open/<target>` opens that screen. If the app has no account, `add-device` leads to the add-device screen and `open/*` to sign-up; if it already has an account, the add-device screen says so and offers nothing destructive. An unknown, malformed or refused link shows a message and changes nothing.

## Files opened from the file manager

| Kind | Recognised by | Limit | Goes to |
|------|---------------|-------|---------|
| `csv` | extension `.csv` | 16 MiB | the import panel, file chosen, preview shown, nothing imported until confirmed |
| `backup` | extension `.cashfold-backup` | 128 MiB | the restore form, file chosen, passphrase requested, nothing restored until confirmed |

Rules:
1. The shell opens the path it was given by the system and checks, on the open descriptor, that it is a regular file (not a directory, device, pipe, or link to one) and that its size is within the limit, **before reading it**.
2. The page receives the file name only (no directory), at most 120 characters.
3. Anything else (other extensions, empty files, oversized files) is refused with a message that names the reason.
4. The import and restore flows keep every check they already have (row cap, format, passphrase, empty-Fold requirement for restore).

## Dropped files (page only)

| Target | Accepted | Limit | Result |
|--------|----------|-------|--------|
| the window | `.csv` | 16 MiB | the import panel with the file chosen |
| the add-transaction sheet | the receipt kinds the attachment field already accepts | 25 MB | shown as the attachment, stored only when the transaction is saved |

Dropped files are only handled in the desktop app, only while unlocked, and are checked for kind and size before they are read.

## Delivery and queueing

1. The shell queues items (at most 8, and at most 256 MiB of file bytes; the oldest is refused with a message beyond that). It delivers a file's contents only while the page reports `unlocked`, so a locked page never receives them. A link, or a refusal, carries no content and is delivered as soon as the page has told the shell it can take items (the preload sends `cashfold:incoming-ready` when a listener is registered; it is reset when a new document loads).
2. The page opens the first item at once and shows the others one at a time, behind a "show the next one" button. It keeps no file contents while locked.
3. A second launch, a link or a file hands over to the running copy and brings its window to the front.
4. Items are kept in memory only and dropped on quit.

## Logging and display

Links and file paths are never written to a log in full. A log line records the kind, the decision (`accepted` or `refused`) and the reason code only. A link's values are never put in a window title, a notification, a tray or menu entry, or the operating system's recent-items list (the shell does not register opened files with the recent-documents list).
