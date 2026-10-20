# What the service can see

Cashfold keeps your financial data encrypted on your devices. The service (the relay) stores and forwards ciphertext. This page lists **exactly** what it can learn, so you can judge the trade-off (FR-011, FR-012). Anything not listed here is either encrypted with a key the service never has, or not sent to it at all.

If you run your own service, everything below is visible to whoever runs it.

## What the service cannot read

- Amounts, dates, names, notes, categories, payees, tags, places, budgets, goals, schedules, exchange rates you entered, and the names and base currencies of your Folds.
- The contents of attachments, and their file names and types.
- Your password, your Secret Key, your Recovery Key, and any key that decrypts anything. Sign-in uses a zero-knowledge password protocol (SRP): the password is never sent, and a copy of the service's database does not let anyone guess it offline faster than guessing it against your own key set.
- Which records exist, what kind of record an operation touches, or what an operation changed. All of that is inside the encrypted payload.

## What the service can see

### About your account

| Information | Why the service has it |
| --- | --- |
| Your **email address**, in readable form | To send the confirmation link and invitation notices. Lookup by address uses a keyed hash. It is only findable by others if you leave "let people find me by email" on (the default) |
| Your **account id** (six characters, not secret) | Names the account |
| Whether the address is confirmed, and when the account was created | Confirmation and abuse control |
| The password-stretching settings and salts, and the **SRP verifier** | Needed to sign you in. Neither reveals the password |
| Your **encrypted key set**, and your public keys | Lets a new device fetch what it needs. The private keys are sealed under a key made from your password *and* Secret Key, neither of which the service has |
| If you made a **Recovery Key**: a second verifier and your private keys sealed under it | Lets you get back in. The service cannot open them |
| Failed sign-in attempts and any temporary lock | Brute-force protection |
| Whether you are discoverable | Your choice |

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

From that it can tell *that* you are active, *when*, *how much* and *on how many devices*, and which members of a shared Fold write to it. It cannot tell what you wrote, what kind of record it was, or whether it was an expense, an account or a note.

### About attachments

The number and sizes of the encrypted pieces of each attachment (64 KiB pieces, the last one shorter) and which Fold they belong to. Sizes are not padded in this release, so the size of a file is visible to within one piece.

### Snapshots

An occasional encrypted snapshot of a Fold's state, with the sequence number it covers and its size.

### Connection data

Like any web service, it sees the **network address** your requests come from and when. The service keeps request counters in memory to limit abuse. It does not write network addresses to its database. Whoever hosts it, or sits between you and it, can see the same.

### Email it sends

Confirmation links and invitation notices. A notice names only the person inviting you, and contains no Fold name or financial information.

## What is public

The exchange-rate table is the same for everyone and is served to anyone who asks. Asking for it reveals nothing about what you hold.

## After deletion

Deleting your account removes your account, devices, key set, grants and every Fold you were the only member of. For Folds shared with others you leave them. The service keeps only a **tombstone** with your account id and the deletion time, so that your other devices learn the account is gone and erase themselves.

## What would change this

Padding payloads and attachments to hide sizes, and coarsening timestamps, are possible later hardening. They cost bandwidth and are not part of this release. Reading the table above against your own threat model is the honest way to decide whether the service is for you.
