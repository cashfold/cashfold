# Feature Specification: Language Choice Only Where It Belongs

**Feature Branch**: `005-language-choice-placement`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "We should not have a language pickers on almost all pages. We should detect language automatically, and allow user to choose another language during creating an account. But after that we should allow to change the language only in settings."

## Clarifications

### Session 2026-10-25

- Q: Should the unlock page keep a language control for people who can't read the language it is shown in? → A: No. The unlock page has no control; the language is changed only in Settings after unlocking.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pages show the right language without asking (Priority: P1)

A person opens Cashfold and sees it in their language straight away, chosen from their browser or device. The home page, unlock screen, recovery page and add-device page carry no language control: they only show the language, whether it came from detection or from a choice the person made earlier on this device.

**Why this priority**: Today a language control sits at the foot of every page shown before sign-in. It clutters screens whose job is to unlock, recover or add a device, and it invites a change that nobody needs at that moment. Removing it is the core of this request, and automatic detection already gives most people the right language.

**Independent Test**: Open the home, unlock, recover and add-device pages with the browser set to Ukrainian, then Polish, then a language we do not offer. Each page is in the detected language (English for the last) and none has a language control.

**Acceptance Scenarios**:

1. **Given** a browser whose preferred language is Polish and no saved choice, **When** a person opens the home page, **Then** it is in Polish and has no language control.
2. **Given** an account that exists on this device, **When** the unlock page is shown, **Then** it is in the saved language (or the detected one if none was saved) and has no language control.
3. **Given** the recover page and the add-device page, **When** they are shown, **Then** neither has a language control.
4. **Given** a browser language we do not offer, **When** any page is shown, **Then** it is in English.

---

### User Story 2 - Choose another language while creating the account (Priority: P2)

On the sign-up page, where a person is deciding to start using the app, the detected language is shown and a language control lets them pick another. Switching changes the page at once without losing what they typed. The chosen language is kept for the account on this device and is used for the first Fold and the default categories that are created.

**Why this priority**: People on a shared or work computer often want a language other than the browser's, and sign-up is the one moment they should be asked. It builds on Story 1.

**Independent Test**: With an English browser, open the sign-up page, type an email address, switch to Ukrainian, and confirm the page changes, the address is still there, and the control is present. Finish creating the account and confirm the app stays in Ukrainian with a Ukrainian-named first Fold.

**Acceptance Scenarios**:

1. **Given** the sign-up page in the detected language, **When** the person chooses another language, **Then** the page changes at once and anything already typed is kept.
2. **Given** a language chosen on the sign-up page, **When** the account is created, **Then** the Secret Key screen, the signed-in app and the starter names are in that language.
3. **Given** a language chosen on the sign-up page, **When** the person reloads before creating the account, **Then** the page is still in the chosen language.
4. **Given** the sign-up page, **When** it is shown, **Then** the language control is the only one on any page shown before sign-in.

---

### User Story 3 - Change the language later only in Settings (Priority: P3)

After the account exists, the language is changed in one place: Settings → Appearance. The setting offers the available languages and "Automatic" (follow the browser). A change applies at once and is remembered on the device. No other page offers it.

**Why this priority**: One predictable place is easier to find and to explain than a control scattered over pages. It matters less than the first two because the setting already exists.

**Independent Test**: Sign in, open Settings → Appearance, choose Polish, and confirm every screen changes and the choice survives a reload. Browse every other screen and confirm none has a language control.

**Acceptance Scenarios**:

1. **Given** a signed-in person, **When** they choose another language in Settings → Appearance, **Then** the app changes at once without signing them out or losing their place.
2. **Given** a saved choice, **When** the browser language differs, **Then** the saved choice wins, until the person picks "Automatic".
3. **Given** "Automatic" is chosen, **When** the app opens, **Then** it follows the browser's languages again.
4. **Given** any signed-in screen other than Settings → Appearance, **When** it is shown, **Then** it has no language control.

---

### Edge Cases

- A person picks a language on sign-up they cannot read well and wants to undo it: the control is still on the sign-up page until the account is created, and in Settings afterwards.
- A person leaves sign-up without creating an account: the saved choice stays on this device and applies to the pages they see next (home, add-device), but no control is offered there. Opening the sign-up page again shows the control with their choice selected.
- Adding a device to an existing account on a new device: the page is in the detected language and has no control; the language the account uses elsewhere is not carried over, and the person can change it in Settings once signed in.
- A device with an account where the saved language is unreadable to the person using it (for example a shared computer): decided that the unlock page offers no way to change it. They unlock (one password field and one button, whatever the language), then change it in Settings, which is reachable by the same icons and layout whatever the language.
- A browser that lists several languages, or a regional variant such as `pl-PL`: detection works as before (first supported language in order, base language), and English is the fallback.
- The desktop app: it follows the same rules; its menu and start-up dialog behave as they did.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST pick the language automatically, from the saved choice if there is one, otherwise from the browser's or system's preferred languages in order, otherwise English.
- **FR-002**: The home page, unlock page, recover page and add-device page MUST NOT offer a language control, with no exception and no reset link on the unlock page. They show the language only.
- **FR-003**: The sign-up page MUST offer a language control, listing each available language in its own language, so that a person can choose a language other than the detected one while creating the account.
- **FR-004**: Choosing a language on the sign-up page MUST apply at once, keep what has been typed, and be remembered on the device (including across a reload before the account is created).
- **FR-005**: The language shown when the account is created MUST be the language used for that account's first Fold and default categories, as already specified in FR-015 of spec 004.
- **FR-006**: After sign-in, the language MUST be changeable only in Settings → Appearance, which MUST offer the available languages and "Automatic".
- **FR-007**: No other screen, dialog or sheet of the signed-in app MAY offer a language control.
- **FR-008**: A change made in Settings MUST apply at once, keep the person's place, not require signing in again, and be remembered on the device.
- **FR-009**: A saved choice MUST take priority over the browser's language until the person chooses "Automatic".
- **FR-010**: The language choice MUST stay on the device only: it is not synced, exported or sent to the service (unchanged from spec 004).
- **FR-011**: The desktop app MUST follow the same placement, and its menu MUST keep following the language shown.
- **FR-012**: The language control's accessible name and its option names MUST remain translated or written in their own language (unchanged from spec 004), so it can be found from a page that cannot be read.

### Key Entities

- **Language choice**: the person's saved selection (a language, or "Automatic"), stored on the device. It is set on the sign-up page or in Settings, and read everywhere.
- **Detected language**: the language derived from the browser's or system's preferences when no choice is saved.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Exactly 2 places in the whole app offer a language control: the sign-up page and Settings → Appearance. A walk through every other page and screen finds none.
- **SC-002**: On a first visit with a supported browser language, 100% of pages shown before sign-in are in that language with no action by the person.
- **SC-003**: A person creating an account can switch language on the sign-up page in 1 interaction and sees the page change in under 1 second, with no typed input lost.
- **SC-004**: The language chosen at sign-up is the language of the first screen after account creation and of the starter names in 100% of checks.
- **SC-005**: A person can find where to change the language after sign-up in no more than 3 interactions from any signed-in screen.
- **SC-006**: A saved choice survives a reload in 100% of checks and is not overridden by a different browser language.

## Assumptions

- "Almost all pages" means every page shown before sign-in except the sign-up page. The sign-up page is the one place to choose during account creation; the secret-key step that follows creation does not need its own control.
- Unlock, recover and add-device pages stay free of a control even for a person who cannot read the language shown: it is rare, they can still sign in, and Settings offers the change right after.
- The language chosen on a device is not carried to another device when an account is added there; detection decides, and Settings changes it.
- The existing set of languages (English, Ukrainian, Polish) and "Automatic" are unchanged; this work only moves where the choice is offered.
- Removing the control from those pages does not change how the language is detected, stored or translated, or the desktop menu's behaviour.
