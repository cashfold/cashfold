# Feature Specification: Privacy Mode

**Feature Branch**: `016-privacy-mode`

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "Privacy mode. Let a person hide the money on screen until they choose to show it, and keep notification text free of amounts and names, so Cashfold can be used in public (on a train, on a shared screen, over someone's shoulder). A Privacy mode switch in Settings, off by default. When it is on, every money amount shown in the app is masked and keeps its shape so layouts do not jump; names, dates, categories and notes stay visible. A person can reveal one amount at a time, and it hides again on its own, when they leave the screen, or when the app locks. A single key press turns Privacy mode on or off, and its state is clear at a glance. Screen readers must not read hidden amounts. Copying, exporting and printing give real figures; the add and edit forms always show what the person types. Notifications say only that something needs attention, with no amounts, payee names, account names or counts, by default; a separate setting lets the person include the details. Both settings are stored on this device only and survive signing out. Out of scope: hiding the window in the app switcher or from screen capture, step-up re-authentication, masking names, notes or dates, per-account or per-Fold rules, and server push notifications."

## Clarifications

### Session 2026-10-31

- Q: Should graphics that show relative size (bars, trend lines, progress bars) and percentages stay visible while Privacy mode is on? → A: Yes. Only figures, axis values and tooltip values are masked; shapes and percentages stay.
- Q: Should a masked amount keep its currency code? → A: Yes. The mask stays next to the code (for example "•••• USD").

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hide the money on screen and reveal one amount at a time (Priority: P1)

A person turns on Privacy mode in Settings. From then on every money amount in the app shows as a row of dots instead of a figure, so someone looking over their shoulder sees names, dates and categories but no amounts. When the person wants to see one amount, they click or press it, read it, and it hides again by itself after a few seconds.

**Why this priority**: This is the core of the feature and works on its own. It is what lets someone use the app on a train or on a shared screen.

**Independent Test**: Turn Privacy mode on, then open Overview, Accounts, Transactions, Plan (budgets, goals, schedules), the account pickers and the Settings screens. Confirm that no amount is readable anywhere, reveal one amount, and confirm that it hides again on its own.

**Acceptance Scenarios**:

1. **Given** Privacy mode is off, **When** the person turns it on in Settings, **Then** every amount on the open screen is masked at once, with no reload.
2. **Given** Privacy mode is on, **When** the person opens any screen that shows money (balances, transaction amounts, totals, income and spending figures, budget and goal figures, chart values, dropdown balances, dialogs), **Then** each amount is masked and the layout does not change width or move.
3. **Given** a masked amount, **When** the person clicks it or focuses it and presses Enter or Space, **Then** only that amount shows its real figure, and it hides again after a few seconds.
4. **Given** a revealed amount, **When** the person goes to another screen, the app locks, or the window is left, **Then** every amount is masked again.
5. **Given** a masked amount in a list of transactions, **When** the person looks at the row, **Then** the date, payee, category and note are still readable, and nothing about the sign or direction of the amount is shown by text or by colour.
6. **Given** Privacy mode is on, **When** the person opens the account dropdown in the add form or a filter, **Then** the account names show without their balances.

---

### User Story 2 - Switch Privacy mode on and off with one key press (Priority: P1)

When someone sits down next to the person, they press one key to hide the money, and press it again later to show it. The app always shows whether Privacy mode is on.

**Why this priority**: Hiding the money has to be faster than the moment a stranger glances over. A switch buried in Settings would not protect anyone.

**Independent Test**: With the app unlocked, press the shortcut and confirm every amount is masked within a moment and the indicator shows Privacy mode is on; press it again and confirm the figures return.

**Acceptance Scenarios**:

1. **Given** the unlocked app, **When** the person presses the Privacy mode shortcut, **Then** the mode toggles at once, on every screen, in the web app and the desktop app.
2. **Given** Privacy mode is on, **When** the person looks at the app header or sidebar, **Then** an indicator says so, in words as well as an icon, and pressing it turns the mode off.
3. **Given** the person is typing in a field, **When** they press the shortcut, **Then** it still works and does not type a character into the field.
4. **Given** the desktop app, **When** the person opens Help, **Then** the shortcut is listed with its name and keys written as the system writes them; in a browser Help lists it as well.
5. **Given** the app is locked, **When** the person presses the shortcut, **Then** nothing happens and no setting changes.

---

### User Story 3 - Notifications that say nothing private (Priority: P1)

A reminder or alert can appear on a locked screen or in a corner of a shared screen. By default it says only that something needs attention, for example "Cashfold has a reminder", with no amount, no schedule or payee name, no account name and no count. A person who wants the details can switch them on.

**Why this priority**: A notification is the one place the app shows money outside the app window, where Privacy mode cannot reach. Leaving it out would defeat the purpose.

**Independent Test**: Create a schedule with a recognisable name and amount that is due now, allow notifications, and confirm the notification text contains neither the name nor the amount. Turn details on and confirm they appear.

**Acceptance Scenarios**:

1. **Given** notifications are allowed and the details setting is off, **When** a reminder comes due, **Then** the notification reads as a generic message in the app's language, with no amount, schedule name, payee, account name or count.
2. **Given** several reminders come due together, **When** they are shown, **Then** one generic notification is shown, with no count.
3. **Given** the details setting is on, **When** a reminder comes due, **Then** the notification names the schedule and the day, and shows the amount only if the person also allowed amounts.
4. **Given** a notification is shown, **When** the person chooses it, **Then** the app comes forward and opens the schedules, as it does today.
5. **Given** the dock or tray badge, **When** reminders are waiting, **Then** it shows a count only, as before.
6. **Given** Privacy mode is off, **When** a reminder comes due, **Then** notifications are still generic unless the details setting is on: the two settings are independent.

---

### User Story 4 - Settings that stay on this device (Priority: P2)

The Privacy mode switch and the notification-details switch sit together in Settings with a plain description of what they hide and what they do not. They belong to the device: they survive a restart and signing out, and are never sent anywhere.

**Why this priority**: People need to understand what they are turning on, and a protection that vanishes on sign-out or follows an account to another device would surprise them. The feature works without a polished settings page, so this is P2.

**Independent Test**: Turn both settings on, restart the app, sign out and sign in again, and confirm both are still on. Confirm nothing about them appears in sync traffic or exports.

**Acceptance Scenarios**:

1. **Given** Settings, **When** the person opens the section, **Then** both switches are there, off by default, each with a description of what it covers and what it does not (names, dates, notes and the window itself are not hidden).
2. **Given** both are on, **When** the app restarts or the person signs out and signs in, **Then** both are still on.
3. **Given** a second device signed in to the same account, **When** the first device changes either setting, **Then** the second device is not changed.
4. **Given** a person who already allowed amounts in reminder notifications before this feature, **When** they update, **Then** their choice is kept and they see the new details setting turned on.

---

### User Story 5 - Real figures where the person acts on them (Priority: P2)

Privacy mode only changes what is shown on screen. Typing into the add and edit forms, copying a figure, exporting, backing up and printing give the real figures. A person is never made to enter an amount blind.

**Why this priority**: Masking input or exports would cause wrong entries and false confidence. The feature must make it safe to leave Privacy mode on all day.

**Independent Test**: With Privacy mode on, add a transaction, edit it, export to CSV and check the file, copy a revealed amount, and print a screen; confirm each uses real figures.

**Acceptance Scenarios**:

1. **Given** Privacy mode is on, **When** the person types an amount in the add or edit form, **Then** the field shows what they type, and the saved value is exactly what they typed.
2. **Given** Privacy mode is on, **When** the person exports data or makes a backup, **Then** the files contain the real figures, unchanged.
3. **Given** a masked amount, **When** the person selects and copies it, **Then** nothing real is copied; after revealing it, the copied text is the real figure.
4. **Given** Privacy mode is on, **When** the person prints a screen, **Then** the printed page follows what is on screen (masked amounts stay masked), and the person is told that export gives real figures.

---

### Edge Cases

- **Screen readers**: a masked amount is announced as "Hidden amount" with a hint that it can be revealed, never as a figure, and the real figure is not present anywhere in the page text, labels, titles or tooltips while masked. A revealed amount is announced normally, and the reveal and the hiding are announced politely.
- **Keyboard only**: every masked amount can be reached and revealed from the keyboard; revealing does not move focus.
- **Touch**: tapping a masked amount reveals it; there is no hover-only reveal.
- **Several amounts at once**: revealing one amount does not reveal the others, including the same figure shown elsewhere on the screen.
- **Status messages and errors**: a message that would contain an amount (for example a confirmation or an error) follows the same rule and does not show the figure while Privacy mode is on.
- **Window title and page title**: they never contain an amount.
- **Charts and graphics**: values, axis labels and tooltips are masked; shapes that show relative size (bar lengths, trend lines, progress bars) and percentages stay, because they carry no figure.
- **Colour and sign**: a masked amount shows no sign and no gain or loss colour, since either would reveal direction.
- **Many currencies**: each amount is masked on its own and keeps its currency code, so a screen with several currencies does not shift.
- **Very large or very small figures**: the mask has a fixed width, so it does not reveal how many digits the figure has.
- **Reveal expires while focused**: when a revealed amount hides again while it has keyboard focus, focus stays on it.
- **Lock, cover and sign-out**: a revealed amount is masked again before anything else is shown, and all reveal state is discarded.
- **Notifications permission off**: with notifications not allowed, no notification is shown and nothing changes; the details setting is still saved.
- **Notification permission changes later**: a notification already shown keeps the text it had when shown.
- **Language change**: generic notification text and all new labels follow the chosen language.
- **First launch after update**: Privacy mode starts off; only the notification setting is carried over from the earlier "allow amounts" choice.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST offer a Privacy mode switch in Settings, off by default, with a description of what it hides and what it does not hide.
- **FR-002**: While Privacy mode is on, every money amount shown in the app MUST be masked: balances, transaction and transfer amounts, totals, income and spending figures, budget and goal figures, amounts in lists, dialogs and charts, and amounts inside status messages and errors. In a dropdown of accounts the option shows the account name only, because a list of choices has nothing to click to reveal.
- **FR-003**: A masked amount MUST have a fixed width that does not depend on the figure, MUST keep its currency code, and MUST NOT show its sign, its direction or a gain or loss colour.
- **FR-002a**: Graphics that show relative size (bar lengths, trend lines, progress bars) and percentages MUST stay visible while Privacy mode is on; only figures, axis labels and tooltip values in them are masked.
- **FR-004**: Names, dates, categories, notes, tags, payees and other text MUST NOT be masked.
- **FR-005**: A person MUST be able to reveal one masked amount at a time by clicking or tapping it, or by focusing it and pressing Enter or Space. Revealing one amount MUST NOT reveal any other.
- **FR-006**: A revealed amount MUST hide again after a few seconds (about five seconds, never less than four or more than six), when the person goes to another screen, when the window is left, when the privacy cover shows and when the app locks.
- **FR-007**: While an amount is masked, its real figure MUST NOT be present in the page's text, accessible names, titles, tooltips or any other attribute readable by assistive technology or by selecting and copying.
- **FR-008**: A masked amount MUST be announced to assistive technology as a hidden amount with a hint that it can be revealed; a revealed amount MUST be announced normally; reveal and hiding MUST be announced politely, without moving focus.
- **FR-009**: A single keyboard shortcut MUST turn Privacy mode on and off from any screen of the unlocked app, in the web app and the desktop app, including while a text field has focus, and MUST NOT change any existing shortcut or clash with a common browser or system shortcut.
- **FR-010**: The shortcut MUST be listed in the Help dialog with a plain name and keys written the way the person's system writes them, in the desktop app and in a browser.
- **FR-011**: The app MUST show whether Privacy mode is on, at a glance, in words as well as an icon, in the app header or sidebar; activating the indicator MUST toggle the mode.
- **FR-012**: The add and edit forms MUST always show what the person types, and the saved value MUST be exactly what was entered.
- **FR-013**: Exports, backups and copying a revealed amount MUST contain the real figures unchanged; copying a masked amount MUST NOT copy a real figure.
- **FR-014**: Printing MUST follow what is on screen, and the person MUST be told where real figures can be had (export).
- **FR-015**: Masking MUST affect display only: no stored or synced value, calculation, rounding, sort order or export MAY change, and nothing about Privacy mode MAY be sent to any service.
- **FR-016**: Notifications for due reminders and similar alerts, in the desktop app and in the installed web app, MUST by default contain only a generic message that something needs attention, with no amount, schedule or payee name, account name, date or count, and MUST follow the app's language.
- **FR-017**: A separate setting, off by default, MUST let the person include details in notifications. With it on, a notification names the schedule and the day, and shows the amount only if the person has also allowed amounts. The setting MUST work whether or not Privacy mode is on.
- **FR-018**: When several reminders come due together, one generic notification MUST be shown, with no count.
- **FR-019**: Choosing a notification MUST keep working as it does now (the app comes forward and opens the schedules), and dock or tray badges MUST keep showing counts only.
- **FR-020**: Both settings MUST be stored on this device only, MUST survive restarts and signing out, MUST NOT be synced, exported or sent anywhere, and MUST NOT follow the account to another device.
- **FR-021**: A person who allowed amounts in reminder notifications before this feature MUST keep that choice, shown as the details setting turned on; Privacy mode starts off for everyone.
- **FR-022**: While the app is locked, the shortcut MUST do nothing, and no amount, indicator or setting MUST be shown.
- **FR-023**: All new text MUST exist in English, Ukrainian and Polish and follow the language chosen in the app, and the new controls and indicator MUST pass the product's existing accessibility checks in light and dark themes and at narrow and wide widths.
- **FR-024**: Privacy mode MUST work offline and MUST NOT add any network request or third-party code.
- **FR-025**: This feature MUST NOT hide the window in the app switcher or from screen capture, MUST NOT mask names, notes or dates, and MUST NOT add per-account or per-Fold rules.

### Key Entities

- **Privacy setting**: a device-local on/off choice, off by default, for masking amounts on screen.
- **Notification detail setting**: a device-local on/off choice, off by default, for including schedule names, dates and amounts in notifications; builds on the earlier "allow amounts" choice, which stays as the second level (amounts only appear when details are on too).
- **Reveal**: a short-lived, in-memory state for one amount that has been shown on purpose; never stored, discarded on navigation, window leave, cover and lock.
- **Masked amount**: the on-screen stand-in for a money figure, with fixed width, the currency code and an accessible "hidden amount" name.
- **Generic notification**: the default notification text that says only that something needs attention.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With Privacy mode on, an automated check across every main screen, dialog and dropdown finds 0 readable money figures in the page's text, accessible names, titles and tooltips.
- **SC-002**: A person can turn Privacy mode on or off with one key press, and every amount on screen changes within 1 second.
- **SC-003**: A person can reveal a single amount in one action (click, tap, or Enter) and it hides again without any action within 4 to 6 seconds.
- **SC-004**: No layout shifts when switching Privacy mode: screens keep the same width and line count for amounts, in every language and at narrow and wide widths.
- **SC-005**: In 100% of tested notifications with the details setting off, the text contains no amount, schedule or payee name, account name, date or count; with it on, the schedule name and day appear as chosen.
- **SC-006**: Exports, backups, saved values and calculations are identical with Privacy mode on and off in 100% of compared cases.
- **SC-007**: After a restart or a sign-out and sign-in, both settings keep their values in 100% of tests, and neither appears in any synced or exported data.
- **SC-008**: A person using only a keyboard, and a person using a screen reader, can turn Privacy mode on, find the state, reveal one amount and turn it off again without help.
- **SC-009**: The new controls and indicator pass the product's accessibility checks in light and dark themes, at narrow and wide widths, and with reduced motion, in English, Ukrainian and Polish.
- **SC-010**: The shortcut appears in the Help dialog and the existing shortcut-consistency test still passes.

## Assumptions

- Amounts that reach the screen through the app's shared money display are covered together; any amount found elsewhere (chart labels, dropdown options, titles, labels) is brought under the same rule as part of this feature.
- The mask is a fixed row of dots with the currency code kept, as the second clarification decided; the exact look is a design detail. The reveal time is about five seconds and can be tuned without changing the spec.
- The exact shortcut keys are chosen in planning so that they do not clash with browser, system or existing app shortcuts, and are listed in Help.
- Relative-size graphics and percentages stay visible, as the clarification above decided; they hold no figure, and hiding them would make budgets and the overview hard to use.
- Tapping reveals on touch devices; there is no hover-to-reveal, because hover would be used by anyone sitting next to the person.
- Today a reminder notification already hides the amount by default but names the schedule and the day; the new default hides those as well, and the earlier "allow amounts" choice becomes part of the new details setting (kept as it was for people who turned it on).
- Printing follows the screen because the app has no separate print layout; export is the way to get real figures.
- Both settings are device preferences, in the same place as the other interface preferences, so they are never synced and signing out keeps them.
- Privacy mode does not lock the app or require re-authentication, and does not replace the lock; it only changes what is drawn.
- The command palette, if present, can offer a "turn privacy mode on or off" command; this feature does not depend on it.
