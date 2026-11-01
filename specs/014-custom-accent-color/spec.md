# Feature Specification: Custom Primary Color

**Feature Branch**: `014-custom-accent-color`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "I want to have the ability to changes the primary color of the app to add some sort of customization to the app. Also we should use this color at the application icon in the system"

## Clarifications

### Session 2026-10-30

- Q: Should the chosen primary color be saved only on the device where it was picked, or follow the person to all their devices? → A: Synced across the person's devices through their encrypted settings.
- Note (2026-11-01): spec 018 removes the icon that followed the color (user story 2); the color itself stays.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose the app's primary color (Priority: P1)

A person opens Settings → Appearance and picks a primary color from a set of ready-made colors. The whole app immediately switches to that color wherever the current green is used today: primary buttons, selected and active states, links, focus rings, highlights and charts' main accent. The choice is remembered, so the app opens with that color next time.

**Why this priority**: This is the core request. It gives people a visible, personal way to make the app theirs, and it works on its own without the icon part.

**Independent Test**: Open Appearance settings, choose a different color, and browse Overview, Accounts, Transactions and Settings. Every element that used the old primary color now uses the new one. Reload the app and confirm the choice persists.

**Acceptance Scenarios**:

1. **Given** the app uses the default color, **When** the person picks another color in Appearance, **Then** the app's primary color changes immediately, with no reload.
2. **Given** a color was chosen, **When** the person closes and reopens the app, **Then** the chosen color is still applied from the first screen shown.
3. **Given** a chosen color, **When** the person switches between light and dark appearance, **Then** the color stays recognisably the same hue and text on it stays readable in both.
4. **Given** a chosen color, **When** the person selects "Default", **Then** the original color is restored.

---

### User Story 2 - App icon follows the chosen color (Priority: P2)

The Cashfold icon shown by the system reflects the chosen primary color, so the personalisation extends beyond the app window. The icon uses the same mark as today, recolored to the chosen color.

**Why this priority**: It is explicitly requested and completes the personalisation, but the in-app color change already delivers most of the value.

**Independent Test**: Choose a color, then check the places where the app icon appears (browser tab, desktop app in the dock/taskbar and window, and the icon offered when installing the app). Each shows the mark in the chosen color.

**Acceptance Scenarios**:

1. **Given** the person picks a color, **When** the change is applied, **Then** the browser tab icon and the desktop app's dock/taskbar icon update to that color without restarting.
2. **Given** a color was chosen before the app is installed to the device, **When** the person installs it, **Then** the installed app icon uses the chosen color.
3. **Given** the person later changes the color after installing, **When** the installed icon cannot be updated by the app itself, **Then** the person is told, next to the setting, that the installed icon updates only after reinstalling or where the system allows it.
4. **Given** the person selects "Default", **When** the change is applied, **Then** the icon returns to the original color.

---

### User Story 3 - Color follows the person across devices (Priority: P3)

A person who uses Cashfold on several devices has their chosen color follow them, instead of picking it again on each device.

**Why this priority**: Requested scope, but it builds on the working single-device color (User Stories 1 and 2), and syncing it must not weaken the privacy promise.

**Independent Test**: Choose a color on one device, sign in on a second device of the same person, and see whether the same color is applied.

**Acceptance Scenarios**:

1. **Given** a color chosen on one device, **When** the person opens the app on another of their devices, **Then** the same color is applied there.
2. **Given** two devices choose different colors while one is offline, **When** both sync, **Then** both end up with the same color (the most recent choice wins).
3. **Given** the person has never chosen a color on a new device, **When** they sign in, **Then** their synced color is applied from the first screen after sign-in.

---

### Edge Cases

- A chosen color has too little contrast with white (or dark) text on buttons: the app must keep text readable, for example by choosing light or dark text automatically.
- The person has the app open in two windows or tabs: changing the color in one updates the other.
- Offline: choosing and applying a color works with no connection.
- Stored choice is missing or invalid (for example after a version change): the app falls back to the default color without errors.
- Negative amounts, warnings and errors keep their own meaning colors (red/amber) and are never replaced by the primary color, even if the person picks a similar hue.
- Before the app finishes loading, the browser tab icon and first paint should not flash the old color.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to choose the app's primary color from a curated set of colors in Appearance settings, plus a "Default" option that restores the original.
- **FR-002**: The system MUST apply the chosen color to every element that uses the primary color today (buttons, selected states, links, focus indicators, highlights, charts' main accent) immediately, without reload.
- **FR-003**: The system MUST remember the choice and apply it from the first screen on the next launch, without a visible flash of the previous color.
- **FR-004**: The system MUST keep text and icons on the primary color readable in both light and dark appearance for every offered color.
- **FR-005**: The system MUST NOT recolor semantic colors (negative amounts, errors, warnings, success).
- **FR-006**: The application icon MUST be shown in the chosen color wherever the app can update its icon (browser tab, desktop app dock/taskbar and window), updating without restart.
- **FR-007**: Icons that the system fixes at install time MUST use the chosen color when the app is installed after the choice was made, and the settings MUST tell the person when an already installed icon cannot change automatically.
- **FR-008**: Choosing and applying a color MUST work fully offline.
- **FR-009**: The icon in every color MUST keep the same mark and safe-area margins as the default icon.
- **FR-010**: If the stored choice is unavailable or invalid, the system MUST fall back to the default color.
- **FR-011**: The choice MUST be shared between all of the person's devices, and the server MUST NOT be able to read it (it travels only within the person's encrypted data).
- **FR-012**: When devices make different choices, the system MUST converge on the most recent choice on every device.
- **FR-013**: Until a device has synced, it MUST apply its last known local choice, and choosing a color MUST work offline and sync later.

### Key Entities

- **Primary color preference**: The person's chosen color from the curated set (or Default). Belongs to the person's appearance settings alongside light/dark choice. Has one value at a time, shared across the person's devices.
- **Application icon variant**: The Cashfold mark rendered in a given primary color, for each place the icon is shown.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can change the primary color in under 10 seconds from opening Settings, and sees the whole app update immediately.
- **SC-002**: 100% of screens show the chosen color for primary actions and selected states, with no leftover default-colored elements, in both light and dark appearance.
- **SC-003**: Text on primary-colored elements meets at least a 4.5:1 contrast ratio for every offered color in both appearances.
- **SC-004**: After restart, the chosen color is shown from the first screen with no visible flash of the default color.
- **SC-005**: In the browser tab and the desktop app, the icon matches the chosen color within 2 seconds of the change.
- **SC-006**: Choosing a color works with no network connection.

## Assumptions

- The choice is a curated palette of about eight to twelve colors plus Default, not a free color picker, so readability and icon quality can be guaranteed. A custom picker is out of scope for this version.
- The default remains the current green.
- Installed web-app (PWA) icons on a device cannot be changed by an app after install on most systems; those icons update at install or reinstall, and the person is informed (FR-007).
- The desktop app can change its dock/taskbar icon at runtime, so it updates live.
- User Story 3 (sync) needs a protocol change and an ADR. It is delivered last and may be descoped to per-device storage if that cost proves too high; User Stories 1 and 2 do not depend on it.
- The preference is synced across the person's devices as part of their encrypted data; the last choice made wins. Each device also keeps a local copy so the color applies instantly at launch and offline.
- The existing icon source is a single placeholder mark; recoloring reuses that mark rather than introducing new artwork.
- The light/dark appearance setting already exists and is the natural home for this setting.
