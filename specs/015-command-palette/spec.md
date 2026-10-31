# Feature Specification: Command Palette

**Feature Branch**: `015-command-palette`

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "Command palette. Add a keyboard-first command palette that opens with Cmd+K on macOS and Ctrl+K elsewhere, in both the web app and the desktop shell. It is a modal search box with a result list, and it lets people jump anywhere or run common actions without the mouse. It lists navigation targets (accounts, envelopes, goals, main screens) and action commands (Add transaction, Lock now, Switch theme, Sign out / switch account, Open Help and shortcuts), shows Recent and Frequent sections when the query is empty (stored only on the device, clearable from Settings), uses fuzzy, case- and accent-insensitive matching with highlighting and grouping, is fully keyboard and screen-reader accessible, never opens or reveals names while the app is locked, and keeps the normal confirmation for commands that need one. Out of scope: settings search with synonyms, saved searches, transaction search or filters, user-defined commands, a global hotkey, and undo."

## Clarifications

### Session 2026-10-31

- Q: With more than one Fold, should the palette list items from only the Fold being viewed or from every Fold? → A: Only the Fold currently being viewed.
- Q: Should palette history be deleted when the person signs out or switches account, or kept? → A: Deleted whenever the account leaves the device. The app holds one account per device, so switching account is signing out ("Use a different account"); there is no separate case where history is kept across a switch. (Revised after the consistency analysis; the first answer assumed several accounts could stay on one device.)
- Q: Spec 011 allows Sign out only from Settings and the lock screen; may the palette also offer it? → A: Yes. The palette is a deliberate extra entry point that amends that decision; the sign-out flow and its confirmation are unchanged.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Jump to an account, envelope, goal or screen (Priority: P1)

A person anywhere in the unlocked app presses Cmd+K (macOS) or Ctrl+K (elsewhere). A search box opens over the app. They type a few letters of what they want, such as "groc" or "holi", see matching accounts, envelopes, goals and main screens grouped by type, move with the arrow keys and press Enter. The palette closes and the app shows the chosen item.

**Why this priority**: This is the core of the feature. Reaching any place in a few keystrokes from any screen is the whole value, and it works on its own without actions or history.

**Independent Test**: With several accounts, envelopes and goals present, open the palette from different screens, type part of a name, choose a result with the keyboard, and confirm the app lands on the right item every time.

**Acceptance Scenarios**:

1. **Given** the unlocked app on any screen, **When** the person presses Cmd+K on macOS or Ctrl+K elsewhere, **Then** the palette opens with the search field focused and a placeholder that shows the shortcut.
2. **Given** the palette is open, **When** the person types "chk", **Then** results narrow to matches such as "Checking" even though the letters are not contiguous, and the matching letters are highlighted.
3. **Given** the palette is open, **When** the person types "cafe", **Then** an item named "Café" matches, and typing in capitals or lower case gives the same results.
4. **Given** results are shown, **When** the person presses the Down and Up arrows, **Then** the highlighted result moves, wrapping at the ends, and pressing Enter opens that item and closes the palette.
5. **Given** matches of several kinds, **When** results are shown, **Then** they are grouped under clear headings (for example Accounts, Envelopes, Goals, Screens, Actions) and each result shows its type.
6. **Given** the query matches nothing, **When** the person looks at the list, **Then** a short "No results" message is shown and Enter does nothing.
7. **Given** the palette is open, **When** the person presses Escape or presses the shortcut again, **Then** it closes and keyboard focus returns to the control that had it before.

---

### User Story 2 - Run common actions from the keyboard (Priority: P2)

From the same palette the person types the name of an action, such as "add", "lock", "theme", "sign out" or "help", and runs it with Enter, without finding the button first.

**Why this priority**: It turns the palette from a finder into a control centre, but navigation already delivers most of the value.

**Independent Test**: Open the palette, run each listed action in turn, and confirm each does exactly what the same action does from its normal place in the app.

**Acceptance Scenarios**:

1. **Given** the palette is open, **When** the person types "add" and presses Enter on "Add transaction", **Then** the palette closes and the new-transaction form opens.
2. **Given** the palette is open, **When** the person runs "Lock now", **Then** the app locks exactly as it does from the Lock control.
3. **Given** the palette is open, **When** the person runs "Switch theme", **Then** the app cycles or toggles its light and dark appearance in the same way as the existing control, and the palette closes.
4. **Given** the palette is open, **When** the person runs "Sign out / use a different account", **Then** the same confirmation the app normally asks for appears before anything is changed.
5. **Given** the palette is open, **When** the person runs "Help and shortcuts", **Then** the Help dialog opens.
6. **Given** an action that is not available in the current state, **When** the person searches for it, **Then** it is not offered, so Enter never does nothing silently.

---

### User Story 3 - Recent and Frequent items when the box is empty (Priority: P2)

When the palette opens with nothing typed, it shows a Recent section (the last things the person opened or ran) and a Frequent section (the things they use most). The person can open their usual places by pressing Enter on the first row.

**Why this priority**: It makes daily use faster than typing, but the palette is fully useful without it.

**Independent Test**: Use a few items several times, reopen the palette with nothing typed, and confirm Recent shows them newest first and Frequent shows the most used first; clear the history in Settings and confirm both sections are gone.

**Acceptance Scenarios**:

1. **Given** the person has opened or run items before, **When** the palette opens with an empty query, **Then** a Recent section lists up to the last few items newest first and a Frequent section lists the most used items, without repeating an item that is already shown in Recent.
2. **Given** a new installation or cleared history, **When** the palette opens, **Then** it shows the main screens and the most common actions instead of empty sections.
3. **Given** a remembered account, envelope or goal was deleted or renamed, **When** the palette opens, **Then** it is not listed, or is listed under its current name, and choosing it never opens a missing item.
4. **Given** Settings, **When** the person chooses to clear the palette history, **Then** Recent and Frequent are emptied on this device after a clear confirmation of what was cleared.
5. **Given** the person uses the app on two devices, **When** they compare, **Then** each device has its own history and nothing is copied between them.

---

### User Story 4 - Works for everyone, in every theme, and respects the lock (Priority: P1)

The palette is fully usable with a keyboard alone and with a screen reader, follows the current light or dark theme, primary color and language, and respects reduced motion. While the app is locked it does not open, and it closes the moment the app locks, so it never shows account names to someone who has not unlocked.

**Why this priority**: Accessibility is part of "done" in the product, and showing account names while locked would break the app's privacy promise, so this cannot ship later.

**Independent Test**: With a screen reader and no mouse, open the palette, search, move through results and run one; lock the app with the palette open and with it closed and confirm nothing is shown or opens; repeat in light and dark themes with reduced motion on.

**Acceptance Scenarios**:

1. **Given** the app is locked, **When** the person presses Cmd/Ctrl+K, **Then** nothing opens and no account, envelope or goal name is shown.
2. **Given** the palette is open, **When** the app locks (by the Lock control, the idle timer or a system event), **Then** the palette closes immediately and the query and results are discarded.
3. **Given** a screen reader, **When** the palette opens, **Then** it is announced as a named dialog with a search field, the results are exposed as a list whose highlighted item is announced, and the number of results is announced after each change to the query.
4. **Given** the palette is open, **When** the person presses Tab or Shift+Tab, **Then** focus stays inside the palette and the page behind it is unreachable, and Escape always closes it.
5. **Given** reduced motion is on, **When** the palette opens and closes, **Then** it appears and disappears without animation.
6. **Given** the light or dark theme and any primary color, **When** the palette is shown, **Then** text, highlights and the selected row meet the product's existing contrast checks.
7. **Given** the app language is English, Ukrainian or Polish, **When** the palette is shown, **Then** all its text is in that language, and matching ignores accents in names.

---

### User Story 5 - The shortcut is discoverable and behaves the same everywhere (Priority: P3)

The palette shortcut is listed in the Help dialog, and the palette looks and behaves the same in the web app and the desktop app.

**Why this priority**: Discoverability and parity matter for adoption, but they depend on the palette itself existing.

**Independent Test**: Open Help on desktop and confirm the shortcut is listed with the right keys for the system; open the palette in a browser and in the desktop app and compare results, ordering and behavior.

**Acceptance Scenarios**:

1. **Given** the desktop app or a browser, **When** the person opens Help, **Then** the palette shortcut is listed with its name and keys written as the system writes them (⌘K on macOS, Ctrl+K elsewhere); in a browser it is the only shortcut shown.
2. **Given** the web app in a browser, **When** the person presses Ctrl+K or Cmd+K, **Then** the palette opens and the browser's own shortcut for that key does not run.
3. **Given** the same data, **When** the palette is used in the web app and in the desktop app, **Then** the same items, groups, order and actions appear.
4. **Given** the automated check that compares the Help list with the desktop shortcuts, **When** the palette shortcut is added, **Then** that check still passes.

---

### Edge Cases

- **Text field has focus**: pressing the shortcut while typing in a field still opens the palette, and focus returns to that same field when it closes.
- **Another dialog is open**: the palette does not open over a confirmation or unsaved-changes dialog; the person must answer that dialog first.
- **Add form open**: the palette does not open over the add-transaction form, so unsaved input cannot be lost by navigating through the palette.
- **Empty app**: with no accounts, envelopes or goals, the palette still offers screens and actions, and says there is nothing else to show.
- **Many items**: with hundreds of accounts, results appear without perceptible delay and the list shows a limited number of best matches with the rest reachable by typing more.
- **Items with identical names**: duplicates are told apart by their type and a short secondary line (for example the group or currency).
- **Very long names**: names are shortened without overlap, and the full name is available to a screen reader.
- **Narrow window or small screen**: the palette fits the width, has no horizontal scrolling, and works at larger text size.
- **Rapid typing**: results always reflect the latest query, and Enter acts on the result the person sees highlighted.
- **Locale-sensitive matching**: letters with accents, and Ukrainian and Polish letters, match their plain forms, and capitalisation is ignored.
- **Palette opened during a sync or status change**: the list updates or stays stable without moving the highlighted row under the cursor unexpectedly.
- **Signing out or using a different account**: palette history is deleted when the account leaves the device, so the next account never sees it.
- **Several Folds**: the palette shows only the Fold being viewed; after the person switches Fold, the palette lists the new Fold's items, and history entries that belong to another Fold are not listed.
- **Item becomes unavailable while open**: if an account, envelope or goal is deleted by a sync while the palette is open, choosing it shows nothing broken and keeps the palette open on the updated list.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: In the unlocked app, in both the web app and the desktop app, pressing Cmd+K on macOS or Ctrl+K on other systems MUST open the command palette from any screen; pressing it again MUST close it.
- **FR-002**: The palette MUST be a modal search box with a result list and MUST NOT open while the app is locked.
- **FR-003**: The palette MUST offer navigation targets: every account, envelope and goal in the Fold currently being viewed (never items from the person's other Folds), and the main screens (Overview, Transactions, Accounts, Plan, Schedules, Devices and sync, Data, Appearance and Settings). Archived accounts are listed only while the person has chosen to show archived accounts.
- **FR-004**: The palette MUST offer actions that already exist in the app: add transaction, lock now, switch theme, sign out (which is also how a person uses a different account) and open Help and shortcuts. Actions that cannot run in the current state MUST NOT be offered.
- **FR-005**: Running an action from the palette MUST do exactly what the same action does from its usual place, including any confirmation, unsaved-changes guard or fresh check it normally requires. The palette MUST NOT bypass or weaken any of them.
- **FR-006**: Matching MUST be fuzzy (typed letters in order, not necessarily contiguous), case-insensitive and accent-insensitive, and MUST rank better matches (prefix and whole-word matches first) above weaker ones.
- **FR-007**: Matching letters in each result MUST be visibly highlighted in a way that does not rely on color alone.
- **FR-008**: Results MUST be grouped by type under headings, each result MUST show its type, and results with identical names MUST be distinguishable.
- **FR-009**: With an empty query the palette MUST show a Recent section (items last opened or run, newest first) and a Frequent section (most used items first), with no item listed twice; when there is no history it MUST show the main screens and the most common actions.
- **FR-010**: The palette's history MUST be kept only on the device where it was created. It MUST NOT be synced to other devices or the server, and MUST NOT be sent anywhere.
- **FR-011**: The history MUST store only what is needed to reopen an item or rerun an action (an identifier and a use count and time), never names, amounts, search text or any other content, and MUST be deleted whenever the account leaves the device (sign-out, using a different account, or removal from the device).
- **FR-012**: Settings MUST offer a way to clear the palette history, which empties Recent and Frequent at once and says what was cleared.
- **FR-013**: The palette MUST be fully usable by keyboard: arrows move through results (wrapping), Enter runs the highlighted result, Escape closes, and the search field is focused when it opens.
- **FR-014**: On close, keyboard focus MUST return to the control that had it before the palette opened, unless the chosen action moved focus deliberately (for example to a form it opened).
- **FR-015**: The search field MUST show a placeholder that includes the palette shortcut written in the notation of the person's system.
- **FR-016**: The palette MUST be announced to assistive technology as a named dialog with a search field and a list of results; the highlighted result and the number of results after each change MUST be announced; focus MUST stay inside while open, with no keyboard trap; and the page behind MUST be unreachable.
- **FR-017**: The palette MUST follow the current light or dark theme, primary color and app language, MUST pass the product's existing accessibility checks, and MUST show and hide without animation when reduced motion is on.
- **FR-018**: The palette MUST close immediately whenever the app locks, however the lock was triggered, and MUST discard the query and results.
- **FR-019**: The palette MUST NOT open over another modal dialog, and MUST NOT open or run anything while the app is locked.
- **FR-020**: Names of accounts, envelopes and goals MAY be shown in the palette, but MUST NOT be written to logs, error messages, URLs or any storage other than the existing local encrypted store; the palette MUST NOT make network requests or add analytics.
- **FR-021**: The palette shortcut MUST be listed in the Help dialog with a plain name and its keys per system (among the shortcuts in the desktop app; as the one shortcut shown in a browser, which amends spec 008's rule that a browser shows none), and the existing automated check that keeps the Help list and the desktop shortcuts in step MUST cover it.
- **FR-022**: Adding the shortcut MUST NOT change any existing shortcut, and in a browser it MUST take precedence over the browser's own use of that key while the app is focused.
- **FR-023**: The palette MUST behave the same in the web app and the desktop app: the same items, groups, order, actions and wording.
- **FR-024**: All new text MUST exist in English, Ukrainian and Polish and follow the language chosen in the app.
- **FR-025**: This feature MUST NOT add undo, settings search, transaction search, saved searches, user-defined commands or a shortcut that works while the app is not focused.

### Key Entities

- **Palette entry**: one selectable row, with a type (account, envelope, goal, screen or action), a display name, an optional secondary line, and whether it is currently available.
- **Palette history record**: a device-local record of one entry's identifier, how many times it was used and when it was last used. It holds no names or content.
- **Palette shortcut**: the key combination that opens the palette, written per system and listed with the other desktop shortcuts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can reach any account, envelope or goal, or start a new transaction, from any screen in at most 5 keystrokes after opening the palette (including the opening shortcut), and in under 5 seconds.
- **SC-002**: After a query changes, the results update with no perceptible delay for a person with at least 500 accounts, envelopes and goals combined.
- **SC-003**: In testing with every listed item and action, 100% of palette results perform the same operation as the equivalent normal control, including its confirmations.
- **SC-004**: While locked, 100% of attempts to open the palette show nothing, and 100% of locks with the palette open close it and clear its contents.
- **SC-005**: A person using only a keyboard, and a person using a screen reader, can complete the tasks of opening the palette, finding an item, and running an action without help.
- **SC-006**: The palette passes the product's accessibility checks in light and dark themes, at narrow and wide widths, and with reduced motion, for English, Ukrainian and Polish.
- **SC-007**: After the palette history is cleared, 0 history entries remain on the device, and at no point is any history sent off the device.
- **SC-008**: The same data and actions produce identical palette results in the web app and the desktop app in 100% of compared cases.
- **SC-009**: The palette shortcut appears in the Help dialog and the shortcut-consistency test passes.

## Assumptions

- The palette searches only items in the Fold being viewed (accounts, envelopes, goals) and the app's top-level screens; it does not search transactions, payees or notes, which is a separate feature.
- Existing app shortcuts, including Cmd/Ctrl+F for search transactions, keep their keys; Cmd/Ctrl+K is currently unused.
- Recent shows a small fixed number of items (about five) and Frequent about five; exact numbers are a design detail and can be tuned without changing the spec.
- "Switch theme" uses whatever the app's existing theme control does today and does not introduce new theme options.
- "Sign out" reuses the existing sign-out flow of spec 011, including its typed confirmation and backup offer. There is no separate "switch account" flow because the app holds one account per device, so the palette lists one command, "Sign out / use a different account". Spec 011 limited Sign out to Settings and the lock screen; the palette is a deliberate extra entry point and amends that decision.
- The app holds one account per device, so the history belongs to that account and is deleted whenever the account leaves the device (sign-out, using a different account, or removal from the device).
- The history is a device preference, not part of the person's synced encrypted settings, because the feature explicitly keeps it local.
- Stored history identifiers are not content, so the existing local storage for device preferences is acceptable; names are always read fresh from the encrypted store.
- The palette shows a limited number of best matches at a time (for example up to 20) to stay fast and readable.
- The feature builds on the existing Help dialog, lock behavior, theme and primary color settings, and desktop shortcut table.
