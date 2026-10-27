# Feature Specification: Installable Web App (PWA)

**Feature Branch**: `009-installable-web-app`

**Created**: 2026-10-27

**Status**: Draft

**Input**: User description: "Make Cashfold a complete installable web app (PWA) on supported browsers"

## Context

Cashfold's web app already has the first parts of a progressive web app: a web app manifest (name, icons including an adaptive one, standalone display), an offline worker that keeps every file of the app on the device, and a check that a reload works offline. What is missing is the finished experience around them. Nothing in the app helps a person install it or explains how. A new version is downloaded in the background, but the web app never tells the person that it is ready or lets them switch to it (the in-app update notice exists only in the desktop app). The manifest has one fixed colour pair, whatever the theme. This feature closes those gaps. It changes the web app only; the desktop app is not touched.

## Clarifications

### Session 2026-10-27

- Q: When the person switches to a new version in one window and the app is open in other windows, what should the other windows do? → A: Each shows a short "Cashfold was updated, restart to continue" notice and restarts by itself as soon as it holds no unsaved input.
- Q: If the system's own start-up screen cannot follow the dark theme, is a brief light start-up screen acceptable when the app's own first screen is dark? → A: Accepted. The criterion covers the app's own first screen; where the system's start-up screen cannot follow the theme, the limit is recorded in the plan and the quickstart.
- Q: When the app is installed and the person opens Settings in the installed window, is the install section hidden or does it say the app is installed? → A: Hidden whenever the app runs as an installed app.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install Cashfold like an app (Priority: P1)

A person who uses Cashfold in a browser wants it in their dock, start menu or home screen, opening in its own window. In Settings there is a short "Install Cashfold" section. Where the browser can install on request, a button does it. Where it cannot, the section gives the right short steps for that browser (for example, Add to Home Screen on iPhone and iPad). Nothing appears on its own: no pop-up, banner or reminder.

**Why this priority**: Installing is the point of the feature. Without a place in the app that explains it, most people never find the browser's own, hidden install option.

**Independent Test**: In each supported browser open Settings, find the section, and install the app by the means it offers; then open the installed app.

**Acceptance Scenarios**:

1. **Given** a browser that can install on request and an app not yet installed, **When** the person opens the install section and presses Install, **Then** the browser's install confirmation appears, and after accepting it the app is installed and the section says so for as long as it stays open in the browser tab.
2. **Given** a browser that cannot install on request (for example Safari on iPhone), **When** the person opens the section, **Then** it shows the steps for that browser, in the person's language, and no button that does nothing.
3. **Given** the app is running as an installed app (in its own window), **When** the person opens Settings, **Then** the install section is not shown.
4. **Given** a browser that cannot install the app at all, or the desktop app, **When** the person opens Settings, **Then** no install section is shown.
5. **Given** any browser, **When** the person uses the app for a long time, **Then** nothing about installing appears unless they open the section.
6. **Given** the person declines the browser's install confirmation, **When** they return to the section, **Then** it is shown again, and Install works, as soon as the browser offers installing again (a browser may wait some time before it does; until then the section is not listed).

---

### User Story 2 - Updating safely, at the person's choice (Priority: P1)

When a new version of the app has been downloaded, the person is told, in the app, that an update is ready. They choose when to switch to it. The switch never happens while they are typing or have unsaved input, and never loses what they entered. If an update fails half way, the app they have keeps working.

**Why this priority**: Today a new version waits unseen and the person may run an old version for a long time, or lose a half-typed entry when the page reloads. For a finance app, updates have to be visible, deliberate and safe.

**Independent Test**: Publish a new version while the app is open with text typed into a form; confirm the notice appears, the typed text is untouched, and switching happens only on the person's choice.

**Acceptance Scenarios**:

1. **Given** the app is open and a new version has finished downloading, **When** the person is on any screen, **Then** a quiet, dismissible notice says an update is ready, without taking focus or interrupting.
2. **Given** the notice, **When** the person chooses to update, **Then** the app restarts into the new version once and, as after any restart of the app, asks for the password; nothing they saved is lost, and a locked app stays locked.
3. **Given** the person has unsaved input, **When** an update is ready, **Then** the notice may appear but the switch is offered only in a way that does not discard the input, or after they have saved or cancelled.
4. **Given** the person dismisses the notice, **When** they keep working, **Then** it does not come back for the same version until the next time the app is opened.
5. **Given** a new version fails to download or install completely, **When** the person keeps using the app, **Then** the current version keeps working and offline use is unaffected.
6. **Given** the app is open in several tabs or windows, **When** one switches to the new version, **Then** each of the others shows a short "Cashfold was updated, restart to continue" notice and restarts by itself as soon as it holds no unsaved input (at once if it is locked or idle), so none runs a mix of old and new files.

---

### User Story 3 - It works offline, and says so (Priority: P1)

After the first visit, every screen of the app opens and every local function works with no connection. The app says plainly when synchronisation is waiting for a connection. The browser's "no internet" page never appears for an address of the app.

**Why this priority**: Offline use is part of the product's promise (local-first) and the reason for installing it. The claim must be true on every screen, not only on the home page.

**Independent Test**: Visit the app, go offline, and open each main screen directly by its address and by navigation, after a reload and after reopening the installed app.

**Acceptance Scenarios**:

1. **Given** the app was opened once online, **When** the connection is lost and the person opens or reloads any screen of the app, **Then** the screen loads and works.
2. **Given** the person is offline, **When** they add a transaction, **Then** it is saved on the device, and the app shows that it is waiting to synchronise.
3. **Given** an address that is not part of the app, **When** the person is offline and opens it, **Then** they see the app's own "page not found" screen with a way back, not the browser's error page.
4. **Given** the person goes back online, **When** synchronisation was waiting, **Then** it resumes without action from them.

---

### User Story 4 - It looks and opens like an app (Priority: P2)

The installed app opens in its own window with the right name and icon, and its title bar, splash screen and window colours follow the app's light and dark themes, with no white flash in a dark window. Pressing and holding or right-clicking its icon offers shortcuts to the main actions: new transaction and the main screens.

**Why this priority**: It turns "a website in a window" into something that feels like an application, but the app is already usable without it.

**Independent Test**: Install the app in each supported browser and system, in a light and a dark system theme, and check the window, the splash screen, the icon and the icon's shortcuts.

**Acceptance Scenarios**:

1. **Given** the app is installed, **When** it is opened from the icon, **Then** it opens in its own window, without the browser's address bar, on the screen the person last used or on Overview.
2. **Given** the system or the app is set to the dark theme, **When** the app opens, **Then** the window, title bar and the app's own first screen are dark from the first frame (a light start-up screen drawn by the system before the app loads is a recorded limit where the system cannot follow the theme).
3. **Given** the person chose a theme in Settings that differs from the system's, **When** the app opens, **Then** the window follows the person's choice, as far as the system allows.
4. **Given** a system that supports icon shortcuts, **When** the person opens the icon's menu, **Then** it offers New transaction, Overview, Transactions, Accounts, Plan and Settings, and choosing one opens it (asking for the password first if the app is locked).
5. **Given** an installed app on Android, **When** the icon is shown, **Then** it fills its shape without a white border (the adaptive icon).

---

### User Story 5 - The data stays safe when installed (Priority: P3)

When the app is installed, the person's data is as protected from the browser clearing it as the browser allows, and if the browser does not agree, the app says so in plain words, as it does now.

**Why this priority**: The app already asks for this and reports a refusal; this story makes sure installing does not weaken or hide it.

**Independent Test**: In a browser that grants persistent storage on install and in one that refuses, check what the app says.

**Acceptance Scenarios**:

1. **Given** the app is installed, **When** the browser agrees to keep its data, **Then** Settings → Data and storage says so.
2. **Given** the browser refuses, **When** the person opens the app, **Then** the existing warning appears, with the usual advice to keep a backup.
3. **Given** installing, updating or uninstalling the app, **When** it happens, **Then** nothing stored, synchronised or sent changes, except what the person did.

---

### Edge Cases

- **Browsers that cannot install:** Firefox on desktop and others show no install section; everything else, including offline and update, still works.
- **First visit with no connection:** the app is not yet on the device, so the browser's own error appears; nothing can be done, and the install section only appears once the app can run offline.
- **Update while locked:** the notice does not reveal anything; the switch keeps the app locked.
- **Update while a sheet or form with unsaved input is open:** see story 2, scenario 3.
- **App installed and also open in a browser tab:** both work, and each shows the correct state of the install section.
- **Uninstalled by the person:** the app goes back to the browser, and the install section appears again.
- **Storage full or data cleared by the browser:** the existing messages apply; installing adds none.
- **iPhone and iPad:** installing is only through the share sheet, and the steps must say so.
- **Long names and translations:** the install steps and update notice stay readable at narrow width in all three languages.
- **Right-to-left layout and larger text:** the new section and notice follow the layout rules the rest of the app follows.
- **Slow or captive networks:** an update that never finishes downloading must not disturb the running app.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST offer, in Settings, an "Install Cashfold" section that lets the person install it where the browser supports installing on request, and gives the correct short steps for their browser where it does not.
- **FR-002**: The install section MUST NOT appear in the desktop app, in an installed app window, or in a browser that cannot install the app, and MUST NOT show a control that does nothing.
- **FR-003**: Nothing about installing MUST appear without the person asking: no pop-up, banner, badge or repeated reminder.
- **FR-004**: The app MUST open every one of its screens, and every local function MUST work, with no connection after the first visit; this includes opening a screen directly by its address and reloading it.
- **FR-005**: An address that is not part of the app MUST show the app's own "page not found" screen while offline, never the browser's error page.
- **FR-006**: The app MUST show plainly, in the language in use, when synchronisation is waiting for a connection, and MUST resume without action when the connection returns.
- **FR-007**: The web app MUST tell the person, in a quiet, dismissible notice that does not take focus, when a new version is ready, and MUST let them choose when to switch.
- **FR-008**: Switching to a new version MUST NOT discard unsaved input, MUST NOT unlock a locked app, and MUST NOT leave any tab or window running a mix of old and new files: every other open window MUST say that the app was updated and restart by itself as soon as it holds no unsaved input.
- **FR-009**: An update that fails or is interrupted MUST leave the current version working, online and offline.
- **FR-010**: The installed app MUST open in its own window with the app's name and icon, including an adaptive icon on Android, and a start screen and window colours that follow the light and dark themes without a white flash in the dark theme.
- **FR-011**: Where the system supports it, the installed app's icon MUST offer shortcuts to New transaction and the five main screens; a shortcut taken while the app is locked MUST lead to the unlock screen first and nothing MUST be read before then.
- **FR-012**: When the app is installed it MUST keep asking the browser to protect its data from being cleared, and MUST keep telling the person when the browser refuses.
- **FR-013**: Installing, updating and uninstalling MUST NOT change what the app stores, synchronises or sends, and MUST NOT add any third-party script, analytics or tracking.
- **FR-014**: All new text MUST exist in English, Ukrainian and Polish, and the new section and notice MUST pass the existing accessibility checks in the light and dark themes, at narrow width and in right-to-left layout.
- **FR-015**: What is shown MUST be what happens: where the app says it works offline, an automated test MUST prove it with the connection off; where it gives install steps for a browser, they MUST match that browser's actual behaviour as recorded in the plan.

### Key Entities

- **Install state**: whether the app can be installed on request, can only be installed by steps, is already installed, or cannot be installed; this decides what the install section shows.
- **Update state**: no update, update downloading, update ready, update dismissed for this version, or update failed; this decides what the notice shows.
- **Connection state**: online or offline, and whether synchronisation is waiting; this is shown in the existing sync indicator.
- **App shortcut**: a named action (new transaction, a main screen) the installed icon can offer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can go from opening Settings to an installed app in 3 steps or fewer in every supported browser that can install.
- **SC-002**: 100% of the app's screens open and work after the first visit with the connection off, including by direct address and after a reload.
- **SC-003**: When a new version is ready, 100% of open sessions see the notice within 1 minute of the download finishing, and 0 switches happen without the person choosing them.
- **SC-004**: In 100% of update tests, text typed before the switch is either kept or the switch is refused; 0 cases lose input.
- **SC-005**: 0 install prompts, banners or reminders appear without the person opening the install section.
- **SC-006**: The installed app's own first screen is dark, with no white flash, in 100% of dark-theme checks. A light start-up screen drawn by the system before the app loads is outside this criterion; each browser where it happens is recorded.
- **SC-007**: The new section and notice pass the existing accessibility checks in both themes and all three languages, with 0 violations.
- **SC-008**: The install steps for each supported browser are verified by someone installing the app in that browser, and the result is recorded.

## Assumptions

- Supported browsers for installing are Chrome and Edge on desktop and Android, and Safari on iPhone and iPad (Add to Home Screen) and on Mac (Add to Dock). Browsers that cannot install keep every other part of the feature.
- The existing offline worker, manifest, icons, storage-protection request and offline-reload test are kept and extended, not replaced.
- Reminders stay on the device. Push notifications from a server are out of scope, because the server must never see data.
- Showing a count of waiting entries on the app icon, and opening CSV files, backups or cashfold:// links from outside the app (both only on some systems) are a separate follow-up. The desktop app already has them, and they carry their own safety rules.
- The update notice follows the desktop app's: quiet, dismissible, never a dialog, and never shown while it would interrupt typing.
- The desktop (Electron) app is unchanged and shows none of the new sections or notices.
- Existing accessibility checks, the three languages and the dark theme are already part of the product's quality gates.
- **Out of scope**: push notifications, packaging for app stores (Google Play, App Store, Microsoft Store), a native mobile app, background sync that sends data while the app is closed, the icon count and the opening of files and links from outside, and any change to the desktop app.
