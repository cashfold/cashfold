# Feature Specification: Local-Only Sign-Up

**Feature Branch**: `010-local-only-signup`

**Created**: 2026-10-28

**Status**: Draft

**Input**: User description: "Local-only sign-up: let people create a Cashfold account without a relay. On the sign-up screen, the service address becomes optional, with a clear choice like 'Keep everything on this device for now'. When no address is given, the account, keys, Emergency Kit and first Fold are created on the device as usual, but nothing is registered with a relay and sync does not start. The sync indicator shows 'Local only', and the 'let people find me by email' option is hidden. Later, in Settings, the person can connect to a relay, which registers the existing account and starts sync without losing any data. If a build supplies a default relay address, the current behaviour stays the default. Everything must work in English, Ukrainian and Polish, and on web and desktop."

## Clarifications

### Session 2026-10-28

- Q: Should a local-only sign-up still ask for an email address? → A: Yes, email stays required, and the sign-up screen says it stays on this device unless the account is connected to a relay.
- Q: Should the app prompt a local-only person to make an encrypted backup? → A: Yes. A one-time backup suggestion after sign-up, and "Make a backup" as a step on the Getting started card while the account is local-only.
- Q: What should the sharing screens do for a local-only account? → A: Show them disabled, with one sentence ("Sharing needs a relay") and a link to the Sync settings.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an account without a relay (Priority: P1)

A person who does not run a relay, and does not want to use anyone else's, wants to start using Cashfold today. On the sign-up screen they choose to keep everything on this device. They finish sign-up exactly as before (password, Secret Key, Emergency Kit) and land in the app with their first Fold, without ever being asked for a service address.

**Why this priority**: This is the reason for the feature. Today the sign-up form requires a service address, so a person with no relay has no honest way in.

**Independent Test**: Open sign-up in a build that has no default relay, choose to keep everything on this device, complete sign-up, and confirm the app is usable and no network request to any service was made.

**Acceptance Scenarios**:

1. **Given** the sign-up screen in a build with no default relay, **When** the person reads the form, **Then** the service address is optional and a clear choice "Keep everything on this device for now" is offered.
2. **Given** the person chose to keep everything on this device, **When** they submit a valid email and password, **Then** the account, Secret Key, Emergency Kit and first Fold are created and the person reaches the app, exactly as with a relay.
3. **Given** the person chose to keep everything on this device, **When** sign-up runs, **Then** nothing is sent to any service and no sync starts.
4. **Given** the person chose to keep everything on this device, **When** they look at the sign-up form, **Then** the "let people find me by email" option is not shown, because it has no meaning without a relay.
5. **Given** the person leaves the service address empty, **When** they submit, **Then** the form does not report an invalid address.

---

### User Story 2 - Know that this device is on its own (Priority: P1)

A person with a local-only account wants the app to say plainly that their data lives only on this device, so a missing sync is never mistaken for a fault, and so they know to keep a backup.

**Why this priority**: Without it, a local-only account would look like a broken sync or like a relay that never answers, and people would not know their data has no second copy.

**Independent Test**: Sign up local-only and check the sync indicator and the Sync settings page on every language.

**Acceptance Scenarios**:

1. **Given** a local-only account, **When** the person looks at the sync indicator, **Then** it reads "Local only" and does not show an offline, error or attention state.
2. **Given** a local-only account, **When** the person opens the Sync settings, **Then** the page explains that data is stored only on this device and offers to connect to a relay.
3. **Given** a local-only account, **When** the app is used offline or online, **Then** it behaves identically, and no sync-related warning ever appears.

---

### User Story 3 - Connect to a relay later (Priority: P2)

A person who started local-only later decides to sync across devices. In Settings they enter a relay address and connect. The existing account is registered with that relay, and sync starts, with everything they entered so far intact.

**Why this priority**: It makes "for now" true. Without it, choosing local-only would be a one-way door and people would hesitate to choose it.

**Independent Test**: Sign up local-only, add accounts and transactions, then connect to a relay from Settings and confirm every record is present, on the relay side as ciphertext and on a second device after sign-in.

**Acceptance Scenarios**:

1. **Given** a local-only account with data, **When** the person enters a valid relay address in Settings and confirms with their password, **Then** the account is registered with the relay and sync starts.
2. **Given** the connection succeeded, **When** the person checks their Folds, accounts and transactions, **Then** nothing is lost, changed or duplicated.
3. **Given** the connection succeeded, **When** the person looks at the sync indicator, **Then** it shows the normal sync states instead of "Local only".
4. **Given** the person is connecting, **When** the relay cannot be reached, the address is invalid, or the email is already registered there, **Then** they see a clear message, the account stays local-only, and no data is lost.
5. **Given** the person is connecting, **When** they fill in the form, **Then** they are asked whether others may find them by email, and it is off unless they turn it on.
6. **Given** the connection succeeded, **When** the person opens Settings, **Then** they can change the "let people find me by email" choice there.

---

### User Story 4 - Builds with a default relay behave as today (Priority: P2)

A person using a build that ships a default relay address (a hosted or organisation build) sees sign-up as it is today, with the address pre-filled. Choosing local-only is still possible for anyone who wants it.

**Why this priority**: It protects the existing experience for people who rely on a hosted service, while the new choice stays available.

**Independent Test**: Open sign-up in a build with a default relay and confirm the address is pre-filled and the current flow is unchanged, then confirm the local-only choice is still reachable.

**Acceptance Scenarios**:

1. **Given** a build with a default relay address, **When** the sign-up screen opens, **Then** the address is pre-filled and sign-up registers with that relay exactly as it does today.
2. **Given** a build with a default relay address, **When** the person picks "Keep everything on this device for now", **Then** they get a local-only account as in User Story 1.

---

### Edge Cases

- A person types a service address and then switches to local-only: the address is ignored and nothing is sent to it.
- A person starts with a relay address that turns out to be unreachable: today's behaviour (the account is created and registers later) is kept, and the indicator shows that registration is pending, not "Local only".
- A person locks and unlocks, restarts the app or reinstalls the desktop app from an existing profile: a local-only account stays local-only and never contacts a relay on its own.
- A person who is local-only exports an encrypted backup: this is the way to keep a second copy, and the Sync settings page points to it.
- A person loses the device before connecting to any relay: the data is recoverable only from a backup. The Emergency Kit alone does not hold the data.
- A person tries to sign in on a second device before connecting: there is no relay to fetch the account from, so sign-in fails like it does for any unknown account (the service never reveals which accounts exist). The Emergency Kit and the Sync settings already say that adding a second device needs a service.
- A person connects to a relay and the relay already has an account for that email: they see the existing "email already used" outcome and keep their local-only account intact.
- A person uses the Ukrainian or Polish interface: every new label, hint, state and message is translated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The sign-up screen MUST let a person create an account without giving any service address.
- **FR-002**: The sign-up screen MUST offer a clear choice to keep everything on this device for now, and MUST explain in one sentence what it means (no sync between devices, back up your data).
- **FR-002a**: The sign-up screen MUST still ask for an email address in local-only mode, and MUST say that it stays on this device unless the account is connected to a relay.
- **FR-003**: A local-only account MUST get the same keys, Secret Key, Emergency Kit, first Fold and starter categories as an account with a relay.
- **FR-004**: A local-only account MUST NOT contact any service or send anything to one, during sign-up or afterwards, until the person connects it. Sync stays idle.
- **FR-005**: The "let people find me by email" option MUST NOT be shown while the person has chosen local-only, and its value MUST NOT be sent anywhere.
- **FR-006**: The sync indicator MUST show "Local only" for a local-only account, and MUST NOT show offline, error, attention or registration-pending states for it.
- **FR-007**: The Sync settings MUST explain that the account is local-only, offer to connect to a relay, and point to the encrypted backup as the way to keep a second copy.
- **FR-006a**: Wherever the app shows the account's details (Settings → Profile and security), a local-only account MUST NOT show an empty service address or a "Pending" registration. It shows "Local only" instead.
- **FR-007a**: After a local-only sign-up, the app MUST show a one-time suggestion to make an encrypted backup, and MUST add "Make a backup" as a step on the Getting started card while the account is local-only. The step MUST be marked done once a backup has been made, and MUST NOT appear once the account is connected to a relay.
- **FR-007b**: While the account is local-only, the sharing and invitation screens MUST be shown disabled with one sentence saying sharing needs a relay and a link to the Sync settings, and MUST NOT fail or disappear.
- **FR-008**: A person MUST be able to connect a local-only account to a relay from Settings by entering an address and confirming with their password.
- **FR-008a**: While connecting, the person MUST be asked whether others may find them by email, and the answer MUST default to off. It can be changed later in Settings.
- **FR-009**: Connecting MUST register the existing account and start sync without losing, changing or duplicating any record, Fold or attachment.
- **FR-010**: If connecting fails, the account MUST remain local-only and fully usable, and the person MUST see a specific, translated reason (address invalid, relay unreachable, email already registered).
- **FR-011**: A local-only account MUST stay local-only across lock, unlock, restart and update until the person connects it.
- **FR-012**: When a build supplies a default relay address, sign-up MUST behave as it does today with the address pre-filled, and the local-only choice MUST remain available.
- **FR-013**: When a build supplies no default relay address, the local-only choice MUST be the default selection.
- **FR-014**: Every new or changed string MUST be available in English, Ukrainian and Polish.
- **FR-015**: The feature MUST work the same in the web app and the desktop app, and the new controls MUST be keyboard-operable and announced correctly by screen readers.
- **FR-016**: The privacy documentation MUST state that a local-only account sends nothing to any service.

### Key Entities

- **Account sync mode**: Whether an account is local-only, waiting to register with a relay, or registered. It decides what the sync indicator says and whether sync runs. It changes only from local-only to registered, and only when the person asks.
- **Relay address**: The optional service address attached to an account. Absent for a local-only account, present once connected.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person with no relay can go from opening sign-up to seeing their first Fold in under 3 minutes, without being asked for a service address.
- **SC-002**: A local-only sign-up and any session of use afterwards (including lock, unlock and restart) produce zero network requests to any service.
- **SC-003**: 100% of the records created while local-only are present and unchanged after connecting to a relay, checked on the device and on a second device.
- **SC-004**: In usability checks after release (a measured outcome, not build work), 9 of 10 people can say from the sync indicator alone that their data is stored only on this device.
- **SC-005**: Every new screen string appears in English, Ukrainian and Polish, with no untranslated key visible in any of them.
- **SC-006**: Sign-up in a build with a default relay takes the same steps as before this feature, with no extra required step.

## Assumptions

- The relay stays optional by design: the README already says that without a relay everything stays on one device, and the app already supports creating an account first and registering later.
- Making the email address optional in local-only mode is out of scope. It is part of how the account's keys and Emergency Kit are made, so removing it would be a separate change.
- A local-only account is never nagged to connect to a relay. For backups, the app's existing data-loss reminder for accounts whose data is only on this device (it appears once there is data and no recent backup, and can be snoozed) applies unchanged. This feature adds only the one-time backup suggestion after sign-up and the Getting started step, and no further recurring prompt.
- Connecting a local-only account to a relay uses the same registration the app already performs when it was offline at sign-up, so no new protocol or server change is needed.
- Moving from one relay to another, or from a relay back to local-only, is out of scope.
- Sharing a Fold with other people needs a relay, so sharing stays unavailable until the person connects (see FR-007b).
- Exchange-rate refresh also needs a relay, so a local-only account uses rates the person enters until it is connected.
- Mobile shells are not part of this feature.
- Changing the password, creating a Recovery Key and deleting the account through the service all need a registered account, as they do for any account that is not registered yet, so they are unavailable until the person connects. A forgotten password on a local-only account cannot be recovered, and the Sync settings say so next to the backup advice. A local Recovery Key is a possible follow-up, not part of this feature.
- The app's screens say "service" where this specification says "relay"; they mean the same thing.
