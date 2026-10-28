# Feature Specification: Sign Out and Switch Account

**Feature Branch**: `011-sign-out-switch-account`

**Created**: 2026-10-28

**Status**: Draft

**Input**: User description: "application should have an ability to logout form current users account, because now i cant change account"

## Clarifications

### Session 2026-10-28

- Q: On the lock screen, where a backup can't be made without the password, how should "Use a different account" protect a local-only account's only copy? → A: The same typed-email confirmation, with the "only copy" warning first, and the backup offer replaced by a hint to unlock first and make a backup if the password is remembered.
- Q: Besides Settings → Profile and security and the lock screen, should "Sign out" also be reachable from the sidebar, next to Lock? → A: No. It is reachable from Settings → Profile and security and from the lock screen only.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Sign out of an account that is also on a service (Priority: P1)

A person whose account is registered with a service wants to stop using it on this device, for example to hand the device to someone else or to use a different account. They choose "Sign out", read what will happen, confirm, and land on a signed-out screen. Their data stays on the service and on their other devices.

**Why this priority**: Today the app holds one account per device and has no sign-out, so a person cannot change account at all. The only ways out are buried (removing this device from the device list, or deleting the whole account) and neither is named or explained as signing out.

**Independent Test**: Sign in on a device with an account that has a service, make a change, sign out, and confirm that nothing of the account is left on the device, that the account is still intact on a second device, and that the same person can sign back in.

**Acceptance Scenarios**:

1. **Given** an unlocked account that is registered with a service, **When** the person opens Settings → Profile and security, **Then** they see a "Sign out of this device" action in plain words, separate from "Lock" and from "Delete my account".
2. **Given** the person chose Sign out, **When** the confirmation opens, **Then** it says that this device's copy of the account will be erased, that the account, its data and the person's other devices are not affected, and that they can sign back in with their Secret Key and password.
3. **Given** the device holds changes that have not reached the service yet, **When** the confirmation opens, **Then** it says how many, and offers to sync them first. If the service cannot be reached it says so and lets the person sign out anyway after an extra confirmation.
4. **Given** the person confirmed, **When** sign-out finishes, **Then** the device shows the signed-out screen, and the account's data, keys, quick-unlock setup and credentials are gone from the device.
5. **Given** the person signed out, **When** they open the account from a second device, **Then** everything is there and this device is no longer a way into it.

---

### User Story 2 - Sign out of an account that exists only on this device (Priority: P1)

A person whose account was kept only on this device (spec 010), or never finished registering, wants to leave it. This is the only copy of their data, so signing out is the same as deleting it. The app makes sure they know, offers a backup first, and asks for a deliberate confirmation.

**Why this priority**: Without it a local-only account can never be left; a person who chose to keep everything on one device would be stuck with it for good. The risk of accidental data loss is also highest here, so the protection is part of the story.

**Independent Test**: Make a local-only account with some data, start to sign out, and confirm that the app warns, offers a backup, asks for the account's email address to confirm, and that after confirming no trace of the account remains. Repeat after making a backup and restore it into a new account.

**Acceptance Scenarios**:

1. **Given** an unlocked local-only account, **When** the person opens the sign-out action, **Then** the confirmation says in the first sentence that this is the only copy and signing out erases it for good.
2. **Given** that confirmation, **When** the person reads it, **Then** it offers "Make a backup first", which takes them to the backup tool and brings them back to the confirmation afterwards.
3. **Given** the person has not made a backup, **When** they try to confirm, **Then** the button stays disabled until they type the account's email address.
4. **Given** the person made a backup, **When** they confirm, **Then** the same typed confirmation is still required, and the confirmation mentions that a backup exists and when it was made.
5. **Given** the person confirmed, **When** sign-out finishes, **Then** the device is signed out and nothing of the account remains.

---

### User Story 3 - Switch to another account (Priority: P1)

A person who signed out wants to use a different account on this device, either by creating a new one or by signing in to an existing one. The signed-out screen offers every way in, and nothing from the previous account is visible.

**Why this priority**: Changing account is the reason for the request. Signing out is only useful if the way back in is just as clear.

**Independent Test**: Sign out of account A, create account B (or sign in to an existing account B), and confirm that only B's data is visible and that nothing from A is found anywhere on the device.

**Acceptance Scenarios**:

1. **Given** the device is signed out, **When** the person opens the app or any screen that needs an account, **Then** they see the same three ways in: create an account, sign in to an existing account on this device (Secret Key and password), and recover an account with a Recovery Key.
2. **Given** the person signed out of account A, **When** they create account B, **Then** B starts empty and A's Folds, accounts, transactions, categories, devices and settings that belong to the account are not shown.
3. **Given** the person signed out of A, **When** they sign in to an existing account B on this device, **Then** B's data appears after sync and nothing from A is mixed in.
4. **Given** the person signed out of A, **When** they sign back in to A, **Then** A is restored from the service as on any new device, with its data and Folds.
5. **Given** the app's language, theme and other preferences for this device, **When** the person signs out and in again, **Then** those preferences are kept, because they belong to the device and not to the account.

---

### User Story 4 - Use a different account from the lock screen (Priority: P2)

A person comes back to a locked device that holds someone else's account, or cannot remember their own password. The lock screen offers a way to use a different account, with the same erasing confirmation, so they are not stuck behind a screen that asks for a password they do not have.

**Why this priority**: Without it a forgotten password means the only way out is to clear the browser's data or the app's folder by hand. It is important but follows from the first three stories.

**Independent Test**: Lock the app, choose "Use a different account" on the lock screen, and confirm that the warnings, the typed confirmation and the erasure behave as in User Stories 1 and 2, and that no password is needed.

**Acceptance Scenarios**:

1. **Given** the locked screen, **When** the person looks at it, **Then** there is a clear "Use a different account" action next to the password field.
2. **Given** the person chose it, **When** the confirmation opens, **Then** it names the account's email address and says that this device's copy will be erased. For an account with no service it says first that this is the only copy, and, because a backup cannot be made while locked, it offers a hint to unlock first and make a backup if the password is remembered, instead of a backup button.
3. **Given** the person typed the account's email address and confirmed, **When** it finishes, **Then** the device is signed out exactly as in User Story 1 or 2, with no password asked.
4. **Given** the person has not typed the email address, **When** they try to confirm, **Then** nothing is erased.

---

### Edge Cases

- A person signs out while the service cannot be reached: the device is still signed out and erased, and the app says that this device may stay listed under the account's devices until someone removes it from another device.
- A person signs out while the app is open in several tabs or windows: all of them move to the signed-out screen, and none keeps showing or editing the account.
- A person closes the app or loses power halfway through signing out: on the next start the sign-out is finished before anything else is shown; a half-erased account is never shown.
- A person signs out of an account that shares a Fold with other people: this device's copy of the shared Fold is erased, and the membership and the others' data are not affected.
- A person signs out of an account that is the owner of a shared Fold: sign-out is allowed, because it removes only this device's copy and not the account's membership.
- A person signs out of an account whose device was already removed from another device: they are taken to the signed-out screen without a second erase, and see the existing "this device was removed" message.
- A person tries to sign out while locked: the lock screen offers "Use a different account" (User Story 4) instead of a plain sign-out, and always asks for the typed email address.
- A person presses sign-out by mistake: nothing happens until they confirm, and the default focus of the confirmation is Cancel.
- A person signs out and then signs in to the same account on the same device: it works as a new device for that account.
- A person uses the Ukrainian or Polish interface: every new label, warning and message is translated.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The app MUST let a person sign out of the current account on this device, from Settings → Profile and security, with a label that says so in plain words ("Sign out of this device" or equivalent). It MUST NOT be placed in the sidebar or the mobile menu next to Lock: the only other entry is "Use a different account" on the lock screen (FR-014).
- **FR-002**: Signing out MUST erase everything that belongs to the account from this device: the encrypted database, all keys and stored credentials, the quick-unlock setup, cached attachments, and any queued but unsent changes.
- **FR-003**: Signing out MUST NOT change the account, its data or its other devices on the service, and MUST NOT delete the account.
- **FR-004**: The app MUST keep the device's own preferences (language, theme, remembered choices and dismissed hints) across sign-out and sign-in, since they are not account data.
- **FR-005**: Before erasing, the app MUST show a confirmation that says what will be erased, what will not, and how to get back in, and its default action MUST be Cancel.
- **FR-006**: For an account registered with a service, the confirmation MUST say how many changes have not reached the service, offer to sync them first, send them itself before erasing when the service can be reached, and, if the service cannot be reached or they still did not arrive, require an extra confirmation to continue.
- **FR-007**: For an account that exists only on this device (local-only, or not yet registered), the confirmation MUST say first that this is the only copy and that signing out erases it for good, MUST offer to make a backup first (on the lock screen, where a backup cannot be made, a hint to unlock first instead, as in FR-014), and MUST require the person to type the account's email address before the confirm action is enabled.
- **FR-008**: When the backup tool is opened from that confirmation, the person MUST be able to return to the confirmation, and the confirmation MUST show whether and when a backup was made.
- **FR-009**: When the service can be reached, signing out of a registered account SHOULD also remove this device from the account's device list on the service, so it does not stay listed. When the service cannot be reached, the device MUST still be signed out and the person MUST be told it may stay listed.
- **FR-010**: After sign-out the app MUST show a signed-out screen that offers three ways in: create an account, sign in to an existing account on this device with its Secret Key and password, and recover an account with a Recovery Key.
- **FR-011**: The signed-out screen MUST NOT show any of the previous account's data, names, email address or other identifying details.
- **FR-012**: Every open tab or window of the app MUST move to the signed-out screen when the account is signed out, and none MUST keep showing or editing the previous account.
- **FR-013**: If sign-out is interrupted, the app MUST finish it on the next start before showing anything else, and MUST NOT show a partly erased account.
- **FR-014**: The lock screen MUST offer "Use a different account", which erases this device's copy, requires the typed email address, and does not ask for the password. Its confirmation is the one above, except that for an account with no service the backup button is replaced by a hint to unlock first and make a backup if the password is remembered, because a backup cannot be made while locked.
- **FR-015**: Sign-out MUST work in the web app and in the desktop app, with the same wording and the same result.
- **FR-016**: Every new or changed string MUST be available in English, Ukrainian and Polish, and the new controls and dialogs MUST be keyboard-operable and announced correctly by screen readers.
- **FR-017**: Signing out MUST NOT write the account's email address, keys or data to logs, and no secret MUST be kept in memory after sign-out finishes.
- **FR-018**: The privacy and threat-model documentation MUST describe what sign-out erases and what it leaves with the service.

### Key Entities

- **Account on this device**: The account that is signed in here: its encrypted database, keys, credentials, quick-unlock setup and queued changes. There is at most one per device. Sign-out removes all of it.
- **Device registration**: This device's entry in the account's list of devices on the service. Sign-out removes it when the service can be reached.
- **Device preferences**: Language, theme and remembered choices. They belong to the device and survive sign-out.
- **Backup**: An encrypted copy of the account's data that a person made. It lets them restore a local-only account after signing out.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A person can sign out of an account and reach the signed-out screen in under 1 minute, from anywhere in the app.
- **SC-002**: A person can go from signing out of one account to seeing the first screen of a different account in under 3 minutes.
- **SC-003**: After sign-out, a scan of everything the app stored on the device finds none of the previous account's data, keys, email address or Folds.
- **SC-004**: 100% of sign-outs of an account that exists only on this device are preceded by the "only copy" warning, the backup offer (on the lock screen, the unlock-first hint) and the typed email confirmation.
- **SC-005**: After signing out of a registered account, 100% of its data is still available from a second device and from signing back in.
- **SC-006**: In usability checks after release, 9 of 10 people can tell from the confirmation alone what signing out will and will not do (a measured outcome, not build work).
- **SC-007**: Every new screen string appears in English, Ukrainian and Polish, with no untranslated key visible in any of them.

## Assumptions

- A device holds one account at a time. Keeping several accounts signed in side by side is out of scope; "changing account" means signing out and in.
- Sign-out erases this device's copy rather than hiding it, because a device that keeps an account's encrypted data cannot also hold another account, and because erasing is what makes handing a device over safe.
- Signing out reuses what the app already does when a device is removed from an account: it erases the device's data and clears its credentials. The new part is that a person can start it themselves, from a place named for it, with the right warnings.
- Signing back in to a registered account uses the existing "add this device" sign-in with the Secret Key and password, so no new sign-in method is needed. A local-only account has no way back except a backup.
- Sign-out needs the app to be unlocked, because the password has already been entered. From the lock screen, the typed email address stands in for it, because that path only destroys data and reveals nothing.
- The "Delete my account" action is unchanged. It deletes the account from the service and from every device; sign-out deletes nothing but this device's copy.
- The app's screens say "service" where this specification says "relay".
- Mobile shells are not part of this feature.
