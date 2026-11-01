# What the service can see

Cashfold keeps your financial data encrypted on your devices. The service (the relay) stores and forwards ciphertext. This page lists **exactly** what it can learn, so you can judge the trade-off (FR-011, FR-012). Anything not listed here is either encrypted with a key the service never has, or not sent to it at all.

If you run your own service, everything below is visible to whoever runs it.

## If you keep everything on this device

At sign-up you can choose **Keep everything on this device for now**. An account made that way sends **nothing to any service**: not your email address, not a key, not a request. Sync does not run, exchange rates are the ones you enter, and sharing a Fold is not available. Nothing on this page applies to you until you connect a service later in Settings → Sync. From that moment, everything below applies, and the account is registered as not findable by email unless you tick that box while connecting.

The cost of keeping everything on one device is that there is no second copy. Make encrypted backups (Settings → Data and storage), because a lost device or a forgotten password cannot be recovered by anyone.

## When you sign out

Signing out (Settings → Profile and security, or "Use a different account" on the lock screen) erases **this device's copy** of the account: the database, the keys, the stored credentials, quick unlock and any changes that had not been sent. Your language, theme and lock settings stay, because they belong to the device. Before it erases, an account that is also on a service sends what has not reached it, so nothing is lost; if the service cannot be reached you are told how many changes would be lost and must agree.

If the service can be reached, the device is also removed from the account's list of devices; that one request carries only the device's id. If it cannot be reached, the device may stay listed there until you remove it from another device. The account, its data and your other devices are not changed. You come back with your Secret Key and password, as on any new device.

An account kept only on this device has no other copy, so signing out erases it for good; the app says so first and asks you to type the account's email address. The lock-screen option sends nothing to any service and asks for that address instead of the password.

## What privacy mode hides

Privacy mode (the switch at the bottom of the sidebar, which is also in the top bar on a narrow window so you can turn it on without opening Settings; or Settings → Appearance → Privacy, or the shortcut in Help) hides money amounts **on your screen** until you reveal one, so you can use Cashfold on a train or on a shared screen. It changes what is drawn and nothing else: amounts keep their shape but every digit becomes a blurred zero (for example −1,234.56 USD shows as −0,000.00 USD), with the sign, the gain-and-loss colour and the currency code as usual, and a screen reader says "Hidden amount" instead of the figure. Click, tap, or press Enter or Space on one amount to show it for about five seconds; it hides again by itself, when you go to another screen, leave the window, or lock the app. Names, dates, categories, notes, the chart shapes and percentages stay visible, and so does the window itself in the app switcher and in a screen capture.

Nothing is changed or sent: the add and edit forms always show what you type, and exports and backups always hold the real figures. The setting is a device preference, kept in the browser's local storage with your other interface settings, never synced to the service or your other devices, and kept when you sign out.

Notifications for reminders say only that something needs attention ("Cashfold has a reminder"), with no schedule name, day, amount or count, unless you switch on **Show details in notifications** (the schedule's name and the day) and, on top of that, **Show amounts in notifications**. Those two choices are device preferences too. Privacy mode makes no difference to a notification.

## What the command palette remembers

The command palette (Cmd/Ctrl+K) keeps a short list of the places and actions you open most, to show them first. It is stored **only on this device**, in the browser's local storage under the key `cashfold.palette`, and is never sent to the service or to your other devices. It holds an opaque identifier, a count and a time for each entry, at most 24, and never a name, an amount or anything you typed. The names you see in the palette are read from your encrypted data each time it opens. The list is deleted when you sign out or use a different account, and Settings → Data and storage has a button that clears it.

## What the service cannot read

- Amounts, dates, names, notes, categories, payees, tags, places, budgets, goals, schedules, exchange rates you entered, and the names and base currencies of your Folds.
- The contents of attachments, and their file names and types.
- Your password, your Secret Key, your Recovery Key, and any key that decrypts anything. Sign-in uses a zero-knowledge password protocol (SRP): the password is never sent, and a copy of the service's database does not let anyone guess it offline faster than guessing it against your own key set.
- Which records exist, what kind of record an operation touches, or what an operation changed. All of that is inside the encrypted payload.

## What the service can see

### About your account

| Information                                                                             | Why the service has it                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Your **email address**, in readable form                                                | To send the confirmation link and invitation notices. Lookup by address uses a keyed hash. It is only findable by others if you leave "let people find me by email" on (the default) |
| Your **account id** (six characters, not secret)                                        | Names the account                                                                                                                                                                    |
| Whether the address is confirmed, and when the account was created                      | Confirmation and abuse control                                                                                                                                                       |
| The password-stretching settings and salts, and the **SRP verifier**                    | Needed to sign you in. Neither reveals the password                                                                                                                                  |
| Your **encrypted key set**, and your public keys                                        | Lets a new device fetch what it needs. The private keys are sealed under a key made from your password _and_ Secret Key, neither of which the service has                            |
| If you made a **Recovery Key**: a second verifier and your private keys sealed under it | Lets you get back in. The service cannot open them                                                                                                                                   |
| Failed sign-in attempts and any temporary lock                                          | Brute-force protection                                                                                                                                                               |
| Whether you are discoverable                                                            | Your choice                                                                                                                                                                          |

### About your devices

Each device's id, public signing key, an **encrypted** label (the service cannot read the name you gave it), when it was added and when it was removed.

### About your Folds and who is in them

- A Fold's id and when it was created.
- **Who belongs to it**: the account ids of its members, their roles (owner, editor, viewer), when they joined, and when they left or were removed. The membership log is signed by the members, stored as written, and readable by the service. It also shows the public keys of members and which key epoch a member's access starts from (the "from now on" or "all history" choice shows up as that epoch).
- Sealed copies of the Fold key addressed to each member (the service cannot open them).
- If a Fold has moved service, the address it moved to.

### About your activity (the operations log)

For every change you make, the service stores a sealed envelope and can see:

- the **Fold**, a random **record id**, the **device** that made it and that device's counter, a **version number**;
- the **time** the change was made, as a clock reading accurate to the millisecond, and the key epoch;
- the **size** of the encrypted payload, which is not padded in this release. A large payload suggests a large change; a very short one a small edit;
- when changes arrive and from which connection.

From that it can tell _that_ you are active, _when_, _how much_ and _on how many devices_, and which members of a shared Fold write to it. It cannot tell what you wrote, what kind of record it was, or whether it was an expense, an account or a note.

### About attachments

The number and sizes of the encrypted pieces of each attachment (64 KiB pieces, the last one shorter) and which Fold they belong to. Sizes are not padded in this release, so the size of a file is visible to within one piece.

### Snapshots

An occasional encrypted snapshot of a Fold's state, with the sequence number it covers and its size.

### Connection data

Like any web service, it sees the **network address** your requests come from and when. The service keeps request counters in memory to limit abuse. It does not write network addresses to its database. Whoever hosts it, or sits between you and it, can see the same.

### Email it sends

Confirmation links and invitation notices. A notice names only the person inviting you, and contains no Fold name or financial information.

### The desktop app and updates

The desktop app (Windows, macOS, Linux) is the same app in its own window, so everything above holds for it too. It adds one thing: it looks for new versions of itself, when it starts and every few hours, by asking GitHub (where releases are published) for a small file that lists the newest version. That request reveals your **network address** and the **version of the app** you run, to GitHub, as any download does, and nothing else: no account, no data, no identifier. Downloading an update, and installing it, happen only when you choose to. You can switch the automatic check off in Settings → Advanced → Updates; you can still check by hand. The desktop app has no analytics, no crash reporting and no other connection of its own; its only other connection is to the service address you chose, exactly as in the web app. With an account kept only on the device, it has no such connection at all.

## What is public

The exchange-rate table is the same for everyone and is served to anyone who asks. Asking for it reveals nothing about what you hold.

## After deletion

Deleting your account removes your account, devices, key set, grants and every Fold you were the only member of. For Folds shared with others you leave them. The service keeps only a **tombstone** with your account id and the deletion time, so that your other devices learn the account is gone and erase themselves.

## What would change this

Padding payloads and attachments to hide sizes, and coarsening timestamps, are possible later hardening. They cost bandwidth and are not part of this release. Reading the table above against your own threat model is the honest way to decide whether the service is for you.
