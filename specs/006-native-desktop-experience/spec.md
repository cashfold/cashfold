# Feature Specification: A Native Desktop Experience

**Feature Branch**: `006-native-desktop-experience`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "Make the Cashfold desktop apps (Windows, macOS, Linux) feel like native applications instead of a website in a window." (seven areas, in priority order: privacy that fits a desktop, looks right from the first frame, keyboard and menus, desktop gestures, presence in the operating system, starting and opening, a frame that belongs to the app)

## Clarifications

### Session 2026-10-25

- Q: When the app is locked, may it still show the waiting-entries badge and fire reminder notifications? → A: No. Nothing while locked: the badge clears and reminders stop when the app locks, and resume on unlock; reminders that fell due while locked are shown as one notification after unlocking.
- Q: Should a `cashfold://` link be allowed to carry the Secret Key, or only non-secret details? → A: Only non-secret details (the email address and the service address). A link never carries the Secret Key or any other secret; the person enters it on the add-device screen (typed, or from the Emergency Kit QR code scanned in the app). The existing `https` link keeps working in browsers as before.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The app locks when the computer does, not when I click elsewhere (Priority: P1)

A person uses Cashfold on a desktop all day next to other programs. Switching to a calculator, a browser or a chat window no longer hides their data. Instead the app locks and hides its content when the computer is locked, goes to sleep, starts its screen saver, or after the idle time the person chose. A person who prefers the old behaviour can switch it back on as an option. The web app is unchanged.

**Why this priority**: It is the most irritating non-native behaviour today, and it is the only area that changes how the app protects data, so it must be specified, reviewed and shipped first.

**Independent Test**: On each desktop system, unlock the app, click another window: the data stays visible. Lock the computer, wait, come back: the app is locked. Set a one-minute idle time, leave the app alone: it locks at one minute. Minimise the window and leave it: it locks at the idle time, not sooner. Turn on "hide when I switch away", click another window: the content is hidden at once.

**Acceptance Scenarios**:

1. **Given** an unlocked desktop app, **When** the person switches to another program, **Then** the content stays visible and nothing is locked.
2. **Given** an unlocked app, **When** the computer is locked, goes to sleep or starts its screen saver, **Then** the app is locked within five seconds and shows no financial data, including in the window switcher and in a screenshot of the window.
3. **Given** an idle time chosen in Settings, **When** the person is inactive for that long, **Then** the app locks.
4. **Given** "hide when I switch away" is turned on, **When** the window loses focus, **Then** the content is hidden immediately and returns when the person comes back (without a password), as it does in the web app today.
5. **Given** the app in a browser, **When** it loses focus, **Then** it behaves exactly as before.
6. **Given** an unlocked desktop app whose window is minimised or hidden in the tray, **When** the person has been inactive for the idle time, **Then** the app locks; **When** the idle time has not passed, **Then** it stays unlocked (the web app's shorter hidden-window time does not apply on desktop), and its content stays covered while the window is not visible.

---

### User Story 2 - It looks right from the first frame (Priority: P2)

The window opens in the person's colours. If the system or the person's chosen theme is dark, the window is dark from its first frame, with no white flash, and it follows a change of the system theme while it runs.

**Why this priority**: It is seen at every launch and is a small, contained change.

**Independent Test**: Set the system to dark, quit and start the app: no white frame appears at any point. Change the system theme while the app runs with the theme set to "System": the app follows within one second. Choose "Light" in Settings with a dark system: the window opens light.

**Acceptance Scenarios**:

1. **Given** a dark system theme and the app's theme set to "System", **When** the app starts, **Then** every frame from the first is dark.
2. **Given** the app's theme set to Light or Dark, **When** the system theme differs, **Then** the app's choice wins, from the first frame.
3. **Given** the theme "System", **When** the system theme changes while the app runs, **Then** the app follows within one second.

---

### User Story 3 - Shortcuts and a real menu bar (Priority: P3)

> **Superseded in part by [spec 007](../007-desktop-native-feel/spec.md):** the application menu bar is removed. Shortcuts stay, but are plain keyboard shortcuts in the shell's shortcut table (`apps/desktop/src/main/shortcuts.ts`, entries flagged `data: true`), with no menu entry and no menu to disable. Read "menu" below accordingly.

The standard keyboard shortcuts work, and the menu bar offers the app's real actions with those shortcuts shown the way the system writes them. The menus are in the language the app is shown in.

**Why this priority**: It makes the app usable at desktop speed, and is independent of the other areas.

**Independent Test**: On each system, trigger each listed action from its shortcut and from its menu entry, and confirm both do the same thing and the menu shows the shortcut that works.

**Acceptance Scenarios**:

1. **Given** the unlocked app, **When** the person uses the shortcut for new transaction, lock, Settings, search transactions, a main section, import or export, **Then** that action happens.
2. **Given** the menu bar, **When** it is opened, **Then** File, Edit, View, Window and Help contain these actions, each showing its shortcut with the platform's own symbols.
3. **Given** the app is shown in Ukrainian or Polish, **When** the menus are opened, **Then** their names and entries are in that language.
4. **Given** the app is locked, **When** a shortcut for a data action is used, **Then** nothing happens or the unlock screen asks for the password; no data is reached.
5. **Given** the platform's usual items (Quit, Hide, Copy, Paste, Zoom, Full screen), **When** the menu is opened, **Then** they are present and work as the system does them.

---

### User Story 4 - Right-click menus, and dropping files in (Priority: P4)

Right-clicking a transaction or an account opens a menu with the actions that row already offers. Dropping a CSV file on the window starts the import with that file chosen; dropping a receipt on the add-transaction sheet attaches it. Nothing is imported or attached without the person confirming, and an unsupported file gets a clear message.

**Why this priority**: These are the gestures people reach for first on a desktop, but each is independent and none changes security.

**Independent Test**: Right-click a transaction and an account, and see exactly the actions their existing action buttons offer. Drop a valid CSV: the import preview opens with it. Drop a picture on the add sheet: it is attached after the person saves. Drop an unsupported file or an oversized one: a message appears and nothing changes.

**Acceptance Scenarios**:

1. **Given** a transaction row, **When** the person right-clicks it, **Then** a menu offers the same actions as its actions button (edit, pin or unpin, duplicate, delete), and choosing delete asks to confirm as it does today.
2. **Given** an account, **When** it is right-clicked, **Then** the menu offers the actions the account already has.
3. **Given** an unlocked app, **When** a CSV file is dropped on the window, **Then** the import opens with that file chosen and shows its preview; nothing is imported until the person confirms.
4. **Given** the add-transaction sheet, **When** a file is dropped on it, **Then** it is shown as the attachment and is only stored when the transaction is saved.
5. **Given** a file of a kind not supported, or larger than allowed, **When** it is dropped, **Then** a message says why and nothing else happens.
6. **Given** a locked app, **When** a file is dropped, **Then** nothing is read and the person is asked to unlock first.

---

### User Story 5 - A presence in the dock, taskbar, tray and notifications (Priority: P5)

The dock icon or taskbar button shows how many scheduled entries are waiting for the person to confirm. Reminders arrive as native notifications, even when the window is closed and the app runs in the background. A tray icon (Windows, Linux) or menu-bar item (macOS) brings the app back, adds a transaction, locks it, or quits it. The dock menu (macOS) and the taskbar jump list (Windows) offer the same quick actions, including opening a recent Fold.

**Why this priority**: It turns the app from something that must be remembered into something that reminds, building on the existing schedules, but it is not needed for the app to be usable.

**Independent Test**: Create scheduled entries that need confirming: the badge shows the count and falls to nothing as they are confirmed. A reminder falls due with the window closed: a native notification appears and choosing it brings the app to the front. Use each quick action from the tray or menu bar.

**Acceptance Scenarios**:

1. **Given** an unlocked app with N scheduled entries waiting for confirmation in the selected Fold, **When** the badge is read, **Then** it shows N, and shows nothing when N is zero; **Given** the app is locked, **Then** the badge shows nothing, whatever N is, and it returns on unlock.
2. **Given** a reminder falls due and notifications are allowed, **When** the app is unlocked, whether its window is open, in the background or hidden in the tray, **Then** a native notification appears within one minute of its due time; **Given** the app is locked, **Then** no notification appears, and after the person unlocks, the reminders that fell due meanwhile are shown as one notification.
3. **Given** the person has not turned on amounts in notifications, **When** a reminder appears, **Then** it shows no amount; with the setting on it shows the amount, as the existing setting says.
4. **Given** a notification, **When** the person chooses it, **Then** the app comes to the front on the matching screen (unlocking first if it is locked).
5. **Given** notifications are not allowed by the system, **When** a reminder falls due, **Then** nothing is shown and nothing breaks, and the badge still counts.
6. **Given** the tray icon, menu-bar item, dock menu or jump list, **When** a quick action is chosen, **Then** it does what its name says; actions that need data ask to unlock first, and the menus show no balance or name that the locked app would hide.
7. **Given** the app is running in the background, **When** the person looks at the tray or menu bar, **Then** it is visible that Cashfold is running, and "Quit" is always offered.

---

### User Story 6 - Start at login, run in the background, open files and links (Priority: P6)

The person can choose to start Cashfold when they sign in to the computer (off by default), started minimised and locked. They choose whether closing the window quits the app or keeps it running in the background; the default follows each platform's habit. Backup and CSV files can be opened with Cashfold from the file manager, and a `cashfold://` link, such as the add-device link, opens the app on the right screen. A link or file only takes the person to the matching screen with its contents shown for review. Only one copy of the app ever runs.

**Why this priority**: It completes the background story (notifications need an app that stays alive) and the "opens like other programs" expectation, but it brings new inputs from outside and so is left after the in-app experience.

**Independent Test**: Turn on start at login, sign out and in: Cashfold is running, locked and has not opened a window in the way. Close the window with "keep running" chosen: the tray item remains. Double-click a CSV in the file manager: the app opens (or comes to the front) with the import preview. Click an add-device link: the app opens on the add-device screen with the details to confirm and nothing else done. Start a second copy: the first comes forward.

**Acceptance Scenarios**:

1. **Given** start at login is off (the default), **When** the person signs in to the computer, **Then** Cashfold does not start.
2. **Given** start at login is on, **When** the person signs in, **Then** the app starts within ten seconds, locked, without opening a window over their work, and visible in the tray or menu bar.
3. **Given** the close choice is "quit", **When** the window is closed, **Then** the app ends; given "keep running", **Then** it keeps running with its tray or menu-bar item, and reminders and the badge continue.
4. **Given** a fresh install, **When** the close choice is read, **Then** it is "quit" on Windows and Linux and "keep running" on macOS.
5. **Given** a backup file or a CSV opened from the file manager, **When** the app receives it, **Then** it goes to the matching screen with the file chosen for review, asks to unlock first if locked, and imports or restores nothing until the person confirms.
6. **Given** a `cashfold://` link, **When** it is opened, **Then** the app comes forward on the screen the link names, with any non-secret details it carries (such as the email address and the service address) shown for the person to confirm; a malformed or unknown link, or one that carries a secret, shows a message and leaves the app as it was.
7. **Given** a second launch, a link or a file while the app runs, **When** it happens, **Then** the running copy handles it and comes to the front; no second copy opens.
8. **Given** a link that carries a Secret Key, password, Recovery Key or any other secret, **When** it is opened, **Then** the app refuses it with a message saying secrets are never sent in a link, the value appears in no log, window title, notification or screen, and the person is shown the add-device screen to enter the Secret Key themselves.

---

### User Story 7 - A frame that belongs to the app (Priority: P7)

The window's title bar becomes part of a slim bar at the top of the app's window that belongs to the app: on macOS the traffic-light buttons sit inside it, on Windows the minimise, maximise and close buttons are drawn in the app's colours, and on Linux the system's own title bar is kept. The bar still drags the window and double-clicking it maximises. On macOS and Windows the sidebar can use the system's translucent window material, with a plain colour where the system or the person's settings do not allow it.

**Why this priority**: It is the biggest visual change and the one that touches the layout of every screen, so it comes last, where it can slip without blocking the others.

**Independent Test**: On each system, drag the window by the bar, double-click it, snap it, maximise it, enter full screen, resize to the smallest size, and use the bar's controls by keyboard: nothing is hidden under the system buttons and everything works. Turn on reduced transparency: the sidebar becomes plain.

**Acceptance Scenarios**:

1. **Given** macOS, **When** the window is shown, **Then** the traffic-light buttons are inside the app's bar at the top of the window with its content kept clear of them, including in full screen where they are not shown.
2. **Given** Windows, **When** the window is shown, **Then** minimise, maximise and close are drawn in the app's colours, behave as the system's (including snap layouts), and are reachable by keyboard.
3. **Given** Linux, **When** the window is shown, **Then** the system's own title bar is used.
4. **Given** any system, **When** the bar's empty area is dragged, **Then** the window moves; **When** it is double-clicked, **Then** the window maximises or restores as the system does; **When** a control in the bar is clicked, **Then** it works and does not start a drag.
5. **Given** macOS or Windows with translucency available, **When** the sidebar is shown, **Then** it uses the system's translucent material; **Given** it is unavailable, or the person has asked for reduced transparency or high contrast, **Then** the plain colour is used and everything stays legible.
6. **Given** any window size, snapped, maximised or full-screen, **When** the app is shown, **Then** nothing is clipped or hidden under the system buttons.

---

### Edge Cases

- Two monitors, and the window is on the one that is disconnected or changes scale: the window comes back inside a visible area, and the title bar stays reachable.
- The computer wakes from sleep: the app is locked, so nothing is shown; after the person unlocks, reminders that fell due meanwhile appear as one notification, not many.
- The system's idle detection is unavailable (some Linux setups): the app falls back to its own idle timer and says so in Settings where relevant; lock on screen-lock may be unavailable there and is not promised.
- Notifications are allowed but the system is in a focus or do-not-disturb mode: nothing special is done; the badge still counts.
- A tray or menu-bar item is not available (some Linux desktops): the app works without it and offers "quit" in the window menu; close-to-background is not offered where the person could not bring the app back.
- A file dropped or opened is a symbolic link, empty, huge, or a CSV with unusual encoding: it is checked, size-limited and shown for review; a failure explains what was wrong.
- A `cashfold://` link carrying a very long or hostile value, or a value that looks like a secret: it is cut off safely, rejected with a message, and nothing is written to logs.
- Several files or links arrive at once: they are handled one after another, each shown for confirmation; none is acted on silently.
- Start at login is on but the person never unlocks: the app stays locked and idle, shows no badge and sends no reminders; nothing leaves the device.
- The app is signed out of its account or has no account yet when a link or file arrives: it goes to the sign-up or add-device screen, never to data.
- A person with the system theme changing at sunset: the app follows without a visible flash.
- Reduced motion, high contrast and large text settings: the new frame, menus and notifications respect them.
- Shortcuts that clash with a system shortcut on one platform: the platform's own wins, and the menu shows the shortcut that really works.
- Right-click on a keyboard-only system: the context-menu key and Shift+F10 open the same menu.

## Requirements *(mandatory)*

### Functional Requirements

**Privacy that fits a desktop (amends spec 001, FR-007, for the desktop app only)**

- **FR-001**: On the desktop app, losing window focus MUST NOT hide or lock the content by default. A setting "Hide the content when I switch to another window" MUST exist, off by default, and when on MUST hide the content immediately and restore it on return without asking for the password, as the web app does.
- **FR-002**: On the desktop app, the app MUST lock and hide all financial content within five seconds of the computer being locked, going to sleep, or starting its screen saver, where the system reports it.
- **FR-003**: The desktop app MUST lock after the idle time chosen in Settings (the existing idle setting). The same idle time MUST apply to a window that is minimised or hidden in the tray (the web app's separate, shorter hidden-window time MUST NOT apply on desktop), and the content MUST stay covered while the window is not visible. A locked window MUST show no financial data in the window, the window switcher, a taskbar or dock preview, or a screenshot of the window.
- **FR-004**: The web app's behaviour on losing focus MUST NOT change.
- **FR-005**: Where the system cannot report a lock, sleep or screen-saver event, the app MUST still honour the idle time and MUST say in Settings which events it can react to on that system.

**Looks right from the first frame**

- **FR-006**: The desktop window MUST be drawn in the colours of the person's chosen theme (or, for "System", the system's current light or dark appearance) from its first frame, with no differently coloured frame at launch.
- **FR-007**: With the theme "System", the app MUST follow a change of the system theme within one second while it runs; with Light or Dark chosen, the app's choice MUST win.

**Keyboard and menus**

- **FR-008**: The desktop app MUST provide keyboard shortcuts for: new transaction, lock, open Settings, search transactions, go to each main section, import, and export, using each platform's conventional modifier keys.
- **FR-009**: The menu bar MUST contain File, Edit, View, Window and Help, with these actions and the platform's usual items, and each action MUST show its shortcut in the platform's notation.
- **FR-010**: Menu names and entries MUST be shown in the language the app is shown in (English, Ukrainian or Polish) and MUST follow a language change.
- **FR-011**: While the app is locked, shortcuts and menu entries that reach data MUST do nothing or lead to the unlock screen; they MUST NOT reveal or change data.

**Desktop gestures**

- **FR-012**: Right-clicking (or the context-menu key) on a transaction or an account MUST open a menu with exactly the actions its existing actions button offers, with the same confirmations.
- **FR-013**: Dropping a CSV file on the window MUST open the import flow with that file chosen; dropping a file on the add-transaction sheet MUST show it as the attachment, stored only on saving the transaction.
- **FR-014**: A dropped or opened file MUST be checked for kind and size before it is read; an unsupported or oversized file MUST produce a clear message and no other effect; nothing MUST be imported, restored or attached without the person's confirmation.
- **FR-015**: While locked, dropped or opened files MUST NOT be read until the person has unlocked.

**Presence in the operating system**

- **FR-016**: The dock icon or taskbar button MUST show the number of scheduled entries waiting for confirmation in the currently selected Fold while the app is unlocked, show nothing at zero, keep the count up to date, and show no other data. While the app is locked it MUST show nothing, and the count MUST NOT be kept anywhere readable outside the encrypted store.
- **FR-017**: While the app is unlocked, reminders for scheduled entries MUST be shown as native notifications within one minute of their due time, whether the window is open, in the background or hidden in the tray; MUST show an amount only if the existing "show amounts in notifications" setting is on; and MUST NOT be repeated for one occurrence. While the app is locked no reminder MUST be shown, and the times, names or amounts of scheduled entries MUST NOT be kept readable outside the encrypted store (the existing list of already-shown reminders holds only opaque identifiers and counters); after the person unlocks, reminders that fell due meanwhile MUST be shown once, as a single notification.
- **FR-018**: Choosing a notification MUST bring the app to the front on the matching screen, after unlocking if it is locked.
- **FR-019**: If notifications are not allowed or not available, the app MUST show none and MUST NOT fail.
- **FR-020**: A tray icon (Windows, Linux) or menu-bar item (macOS) MUST offer: show Cashfold, add a transaction, lock, and quit. The macOS dock menu and the Windows jump list MUST offer: add a transaction, lock, and open a recent Fold. These menus MUST NOT show balances, amounts or Fold names that the locked app would hide, and actions that need data MUST ask to unlock first.
- **FR-021**: Whenever the app is running without a visible window, the tray or menu-bar item MUST show it, and "quit" MUST always be available.

**Starting and opening**

- **FR-022**: A setting "Start Cashfold when I sign in" MUST exist, off by default; when on, the app MUST start after the person signs in to the computer, within ten seconds, locked, without opening a window in front of their work.
- **FR-023**: A setting for what closing the window does (quit, or keep running in the background) MUST exist; its default MUST be quit on Windows and Linux and keep running on macOS; "keep running" MUST NOT be offered where the person would have no way to bring the app back.
- **FR-024**: Backup files and CSV files MUST be openable with Cashfold from the file manager, taking the person to the matching screen with the file chosen for review, asking to unlock first if needed.
- **FR-025**: A `cashfold://` link MUST open the app on the screen it names (the add-device link, for example) with any non-secret details it carries (the email address and the service address) shown for the person to confirm. A link MUST NOT import, restore, sign in, pair a device or change data by itself.
- **FR-026**: Malformed, unknown, too long or hostile links and files MUST show a message and leave the app and its data unchanged.
- **FR-027**: A `cashfold://` link MUST NOT carry a Secret Key, password, Recovery Key or any other secret, and one that does MUST be refused with a message; any such value MUST NOT appear in a log, window title, notification, tray or menu text or recent-items list. The person MUST enter the Secret Key on the add-device screen (typed, or taken from the Emergency Kit QR code scanned in the app), and the existing `https` add-device link MUST keep working in browsers as before.
- **FR-028**: Only one copy of the app MUST run; a second launch, a link or a file MUST be handed to the running copy, which comes to the front.

**A frame that belongs to the app**

- **FR-029**: On macOS the window's traffic-light buttons MUST sit inside the app's own bar at the top of the window, and on Windows the minimise, maximise and close buttons MUST be drawn in the app's colours with the system's behaviour (including snap layouts); on Linux the system's title bar MUST be kept.
- **FR-030**: The app's bar at the top of the window MUST drag the window from its empty area, MUST maximise or restore on double-click as the system does, and every control in it MUST stay clickable and keyboard-reachable without starting a drag.
- **FR-031**: On macOS and Windows the sidebar MAY use the system's translucent material where the system provides it, and MUST fall back to a plain colour where it does not or when reduced transparency or high contrast is on.
- **FR-032**: At every window size, snapped, maximised and in full screen, content MUST NOT be clipped or hidden under the system's window buttons, and the window MUST reopen fully on a visible screen.

**Cross-cutting**

- **FR-033**: Desktop-only behaviour MUST NOT change the web app, and screens MUST NOT offer a desktop-only control outside the desktop app.
- **FR-034**: Nothing new MUST be sent to the service; all of this MUST work offline.
- **FR-035**: Every new piece of text (menus, notifications, tray, dialogs, settings, messages) MUST exist in English, Ukrainian and Polish, and shortcut notation MUST fit the platform.
- **FR-036**: All new interface MUST be usable by keyboard and with a screen reader, including the custom title bar, and MUST respect reduced motion, reduced transparency, high contrast and large text.
- **FR-037**: Anything that comes from outside the app (files, links, drops, notification actions, tray actions) MUST be treated as untrusted: checked, size-limited, and confirmed by the person before anything is done with it.

### Key Entities

- **Desktop preferences** (device-local, never synced): whether the content is hidden when the window loses focus; the idle time; whether the app starts at login; what closing the window does. They are stored by the desktop app itself on the device (not in the web interface preferences, because the app needs to read some of them before any page exists) and are shown only in the desktop app.
- **Waiting count**: the number of scheduled entries waiting for confirmation, derived from existing data and shown as a badge; it is not stored separately.
- **Incoming item**: a file, a link or a notification action that reaches the app from outside, with its kind, its checked size and its confirmation state.
- **Quick action**: a named action (add transaction, lock, open a recent Fold, show, quit) offered from a tray, menu bar, dock menu or jump list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Switching to another program leaves the content visible in 100% of checks on the three systems; the app is locked within five seconds of the computer locking, sleeping or starting its screen saver (where the system reports it) and at the chosen idle time, and a locked window shows no financial data in the window, switcher or a screenshot.
- **SC-002**: In dark mode no light frame appears at launch on any of the three systems in 100% of launches, and a system theme change is followed within one second.
- **SC-003**: Every listed action is reachable by its shortcut and by its menu entry, 100% of menu shortcuts shown are the ones that work, and menus are in the language shown in 100% of checks.
- **SC-004**: A CSV dropped on the window or opened from the file manager reaches the import preview in under two seconds, and 100% of unsupported or oversized files show a message and change nothing.
- **SC-005**: While unlocked, the badge equals the number of entries waiting in 100% of checks, and a reminder appears as a native notification within one minute of its due time, with the window open or the app in the background; while locked there is no badge and no notification, and after unlocking the missed reminders appear once in a single notification.
- **SC-006**: With start at login on, the app is running and locked within ten seconds of the person signing in, without opening a window in the way, in 100% of checks on the three systems.
- **SC-007**: No `cashfold://` link or opened file changes data without an explicit confirmation, and 100% of malformed ones leave the app unchanged with a message; no link accepted by the app carries a secret, a link that does is refused, and no secret value appears in logs, titles, notifications or menus in a scan of a full session.
- **SC-008**: On all three systems the title bar can be dragged, double-clicked, snapped and used by keyboard, and no control is hidden under the window buttons at any size or in full screen, in 100% of checks.
- **SC-009**: Every new text exists in all three languages, and the interface passes the existing accessibility checks, including the custom title bar and the new menus.
- **SC-010**: In a review by people who use native finance apps on their system, the majority can do the main tasks without noticing that the app is built differently.

## Assumptions

- **Scope.** The seven areas ship in priority order and each can be released alone. Unlocking with fingerprint, face or the system's secure storage is a separate feature with its own security design and is not part of this one.
- **Amendment of FR-007 (spec 001).** The desktop app stops hiding content on focus loss by default and locks on the computer's lock, sleep, screen saver and idle instead. The web app keeps FR-007 as written. A short threat-model note records this change, because it moves some of the protection from "hide when I look away" to "lock when I leave".
- **Existing settings are reused.** The idle time, the schedules and their reminders, the "show amounts in notifications" setting, the theme choice and the language choice already exist and are reused; only the desktop-only preferences in the key entities are new.
- **Linux is best effort.** Lock, sleep and screen-saver detection, the tray item and translucency depend on the desktop environment; where one is missing, the app works without it, falls back to the idle timer, and says so in Settings. The system title bar is kept on Linux.
- **Defaults follow each platform's habit.** Close behaviour: quit on Windows and Linux, keep running on macOS. Start at login and "hide when I switch away" are off.
- **Reminders need the app unlocked.** Because the schedule is encrypted, a locked app cannot know what is due. Reminders and the badge therefore work only while the app is unlocked, which with "keep running in the background" means until the idle time locks it. Settings says so next to the idle time and the notification choice, so nobody expects reminders from a locked app.
- **Scope of the badge and reminders.** In this release the badge and the reminders cover the currently selected Fold; counting across all Folds is a follow-up.
- **Reminders on every screen, also in a browser.** Reminders today appear only while the Schedules screen is open. They now run on every screen while unlocked, and because the page code is shared the same improvement applies in a browser, as does the single summary notification after unlocking. This is intentional and the only change in web behaviour; it is covered by a web test.
- **How the success criteria are checked.** The timing of start at login (SC-006) and the review by people who use native finance apps (SC-010) are checked by hand on real systems, in the verification list; the other criteria have automated checks.
- **Running in the background is visible.** Whenever the app runs without a window the tray or menu-bar item shows it and offers quit; where that is not possible the app does not offer to keep running.
- **Files that can be opened or dropped** are CSV files and the app's own backup files, plus the receipt kinds the add-transaction sheet already accepts, within the existing size limits.
- **Links.** The `cashfold://` scheme carries only the non-secret add-device details (the email address and the service address); the Secret Key is always entered by the person. No other link actions are defined by this feature. An existing `https` add-device link, which keeps its secrets where browsers never send them, keeps working in the browser.
- **Out of scope here:** an in-app account switcher, multiple windows, a mini or quick-add floating window, global (system-wide) shortcuts, and any change to what is stored or synced.
