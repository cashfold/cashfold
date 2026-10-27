# Feature Specification: Help Shows the Keyboard Shortcuts

**Feature Branch**: `008-help-keyboard-shortcuts`

**Created**: 2026-10-27

**Status**: Draft

**Input**: User description: "Make the Help button show the keyboard shortcuts. Help at the bottom of the sidebar only brings back the Getting started card, which hides itself once its three steps are done, so for anyone who has set up, Help looks broken. The desktop app has no menu bar, so nowhere lists the keyboard shortcuts. Make Help open a short help dialog with the desktop shortcuts (desktop only), a button to show the getting-started card (only while steps are left), and be accessible and translated."

## Clarifications

### Session 2026-10-27

- Q: When the help dialog is open and an app shortcut is pressed, what happens? → A: The dialog closes, then the shortcut's action runs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See which keyboard shortcuts exist (Priority: P1)

A person using the desktop app wants to know which keyboard shortcuts the app has. There is no menu bar, so they press Help in the sidebar and a short dialog lists the shortcuts with a plain name for each, written the way their system writes keys.

**Why this priority**: This is the reason for the feature. The shortcuts exist but cannot be discovered anywhere today.

**Independent Test**: Open the desktop app on each system, press Help, and compare the list with what each shortcut actually does when pressed.

**Acceptance Scenarios**:

1. **Given** the desktop app on macOS, **When** the person presses Help, **Then** a dialog opens listing the app shortcuts by name (new transaction, lock, Settings, search transactions, go to Overview, Transactions, Accounts, Plan and Settings, import, export), with keys written as on a Mac (for example ⌘N and ⇧⌘I).
2. **Given** the desktop app on Windows or Linux, **When** the person presses Help, **Then** the same actions are listed with keys written as Ctrl+N and Ctrl+Shift+I.
3. **Given** the open dialog, **When** the person reads the "also works" group, **Then** it lists the standard shortcuts (undo, redo, cut, copy, paste, select all in a field, zoom in, zoom out, actual size, close the window, minimise, full screen, quit), with full screen shown as ⌃⌘F on macOS and F11 elsewhere.
4. **Given** the open dialog, **When** the person reads it, **Then** it says that while the app is locked only Lock works.
5. **Given** any listed shortcut, **When** the person presses it in the unlocked desktop app, **Then** the action named in the list happens.

---

### User Story 2 - Keep the getting-started card reachable, honestly (Priority: P2)

A person who has not finished setting up wants the Getting started card back after hiding it. The help dialog offers "Show the getting-started card" while steps remain. Once every step is done, the dialog says so instead of offering a button that would do nothing.

**Why this priority**: It keeps today's only Help behaviour and removes the "Help looks broken" experience for people who have finished setup.

**Independent Test**: With a new empty Fold, open Help and use the button; then complete the three steps and open Help again.

**Acceptance Scenarios**:

1. **Given** at least one getting-started step is not done, **When** the person presses "Show the getting-started card", **Then** the dialog closes and the card is shown on Overview as before.
2. **Given** all steps are done, **When** the person opens Help, **Then** the dialog says setup is complete and shows no such button.
3. **Given** the person is in a browser, **When** they open Help, **Then** the getting-started part still works exactly as in the desktop app.

---

### User Story 3 - Open and close the dialog accessibly, in every layout and language (Priority: P2)

A person using a keyboard or a screen reader opens Help from the sidebar, or from the drawer in a narrow window, reads the dialog, and closes it with Escape or a Close button. Focus returns to Help. All text is in the person's language.

**Why this priority**: A help dialog nobody can reach or leave by keyboard fails the product's accessibility bar.

**Independent Test**: Using only the keyboard, open Help, tab through the dialog, close it, and check focus is back on Help; repeat in a narrow window, in light and dark themes and in each language.

**Acceptance Scenarios**:

1. **Given** the sidebar, **When** the person activates Help, **Then** the dialog opens with keyboard focus inside it.
2. **Given** a narrow window with the navigation drawer open, **When** the person activates Help, **Then** the same dialog opens.
3. **Given** the open dialog, **When** the person presses Escape or activates Close, **Then** it closes and focus returns to Help.
4. **Given** the dialog is open, **When** the person presses Tab or Shift+Tab, **Then** focus stays inside the dialog and the page behind it cannot be reached.
5. **Given** a screen reader, **When** the dialog opens, **Then** it is announced as a dialog with a name, and each shortcut is read as its name together with its keys.
6. **Given** the dialog is open in the unlocked desktop app, **When** the person presses an app shortcut (for example new transaction or Settings), **Then** the dialog closes (and the navigation drawer too, in a narrow window) and that shortcut's action runs.
7. **Given** English, Ukrainian or Polish, in the light or dark theme, **When** the dialog is shown, **Then** all of its text is in that language and the existing accessibility checks pass.

---

### User Story 4 - The list cannot drift from reality (Priority: P1)

A maintainer changes a shortcut in the desktop app. If the help list is not updated to match, a test fails, so the dialog never shows a shortcut that does not work or hides one that does.

**Why this priority**: A help list that lies is worse than none; the feature's value depends on it staying true.

**Independent Test**: Add, remove or change a shortcut the desktop app handles without touching the list, and confirm the test fails; make the list match and confirm it passes.

**Acceptance Scenarios**:

1. **Given** a shortcut the desktop app handles that is not in the list, **When** the tests run, **Then** a test fails naming it.
2. **Given** a listed shortcut the desktop app does not handle, or that is bound to different keys, **When** the tests run, **Then** a test fails naming it.
3. **Given** a shortcut that exists only in unpackaged development runs, **When** the tests run, **Then** it is not required in the list.

---

### Edge Cases

- **Browser**: the web app has none of these shortcuts, so the shortcut section is not shown; the dialog still opens and offers the getting-started part.
- **Locked app**: the dialog is not reachable while locked because the sidebar is not shown; the dialog itself says only Lock works while locked.
- **Dialog open when the app locks**: the dialog closes with the lock and does not reveal anything afterwards.
- **Language changed while open**: the dialog text follows the new language.
- **Window resized to narrow while open**: the dialog stays open and usable.
- **Getting-started steps finish while the dialog is open**: the button is replaced by the "all done" message.
- **Very long translated names**: shortcut names and keys stay readable, with no overlap or clipping and no horizontal scrolling, at the narrow width and at larger text size.
- **Narrow window**: if the navigation drawer is open under the dialog when an app shortcut is pressed, the dialog and the drawer both close before the action runs.
- **Quit on macOS** is handled by the system rather than the app's own shortcut table, and must still be listed.
- **Keys with no modifier or a single function key** (F11) are shown as the system writes them, not as a combination.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Pressing Help, in the sidebar or in the narrow-window drawer, MUST open a help dialog on every system, in the desktop app and in a browser.
- **FR-002**: In the desktop app the dialog MUST list the app shortcuts, each with a plain name: new transaction, lock, Settings, search transactions, go to Overview, Transactions, Accounts, Plan and Settings, import and export.
- **FR-003**: In the desktop app the dialog MUST have a separate "also works" group of the standard shortcuts: undo, redo, cut, copy, paste, select all in a field, zoom in, zoom out, actual size, close the window, minimise, full screen and quit.
- **FR-004**: Each shortcut MUST be written in the notation of the person's system: symbols on macOS (⌘N, ⇧⌘I, full screen ⌃⌘F) and Ctrl-style words elsewhere (Ctrl+N, Ctrl+Shift+I, full screen F11).
- **FR-005**: The dialog MUST state that while the app is locked only Lock works.
- **FR-006**: In a browser the shortcut section MUST NOT be shown.
- **FR-007**: The dialog MUST offer a "Show the getting-started card" button only while at least one getting-started step is not done; pressing it MUST close the dialog and show the card as Help did before.
- **FR-008**: When every getting-started step is done, the dialog MUST say so and MUST NOT show that button.
- **FR-009**: The dialog MUST close with Escape and with a Close button, and focus MUST return to the Help control that opened it.
- **FR-010**: While open, the dialog MUST keep keyboard focus inside it and make the page behind it unreachable, and MUST be announced to assistive technology as a named dialog; every shortcut MUST be readable as its name with its keys.
- **FR-011**: The dialog MUST pass the product's existing accessibility checks in the light and dark themes and in the narrow and wide layouts.
- **FR-012**: All new text MUST exist in English, Ukrainian and Polish and follow the language chosen in the app.
- **FR-013**: Every shortcut shown MUST do what its name says in the unlocked desktop app, and every shortcut the desktop app handles for the person MUST be shown, except shortcuts that exist only in unpackaged development runs.
- **FR-014**: An automated test MUST fail whenever the shortcuts shown and the shortcuts the desktop app handles differ in the action or in the keys on any system.
- **FR-015**: The dialog MUST close if the app locks while it is open.
- **FR-016**: This feature MUST NOT add a shortcut to open Help and MUST NOT change any existing shortcut.
- **FR-017**: Pressing an app shortcut while the dialog is open MUST close the dialog, and the navigation drawer too if it is open beneath it, and then perform the shortcut's action; Lock MUST always work.

### Key Entities

- **Shortcut entry**: a plain name, the action it performs, its keys per system, the group it appears in (app shortcuts or "also works"), and whether it still works while locked.
- **Help dialog**: the single dialog opened from Help, with a shortcuts part (desktop only) and a getting-started part.
- **Getting-started checklist state**: whether any of the steps (create a Fold, add an account, add a transaction) remain.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can find the full list of keyboard shortcuts from anywhere in the unlocked desktop app within 2 actions (press Help, read).
- **SC-002**: 100% of listed shortcuts perform the named action on macOS, Windows and Linux, and 0 working app shortcuts are missing from the list, except development-only ones.
- **SC-003**: Changing, adding or removing a desktop shortcut without updating the list makes the test run fail in 100% of cases.
- **SC-004**: The dialog can be opened, read and closed using only the keyboard, with focus returning to Help every time.
- **SC-005**: The dialog passes the existing accessibility checks in 2 of 2 themes and in 3 of 3 languages.
- **SC-006**: Pressing Help never leaves a person with no visible response: after setup is complete it shows a message instead of a dead button.
- **SC-007**: In a browser, 0 desktop shortcuts are shown.

## Assumptions

- The five main sections are Overview, Transactions, Accounts, Plan and Settings, matching the existing "go to" shortcuts.
- Redo is included in the "also works" group because it is a shortcut the desktop app handles on macOS and the rule "a working shortcut missing from the list is a defect" applies; on Windows and Linux it works through the system's standard editing keys and is listed there too.
- Shortcuts that exist only in unpackaged development runs (reload, developer tools) are not listed.
- Quit is listed on every system even though on macOS the system handles it.
- Whether the app is the desktop app or a browser is already known to the app, so no new detection is needed.
- The getting-started checklist state already exists and is reused unchanged.
- Existing accessibility checks and the three languages are already part of the product's quality gates.
- **Out of scope**: a new shortcut to open Help, a searchable command palette, help articles or links to documentation, and changing any existing shortcut.
