# Feature Specification: Privacy Mode Switch in the Sidebar

**Feature Branch**: `017-privacy-switch-sidebar`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "I want to have a privacy mode switcher available not in settings but always. We can use a sidebar for it. Currently we are showing only a button to turn off the privacy mode when it is on. But to turn it on we should go to the settings."

## Clarifications

### Session 2026-11-01

- Q: On a narrow window, where the sidebar is a drawer, should the switch also be shown in the top bar so it is one tap away? → A: Yes. A compact icon-only switch in the narrow-window top bar shows the state and toggles it; the drawer keeps the full labelled control.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn Privacy mode on from anywhere in the app (Priority: P1)

A person is looking at their accounts and someone sits down next to them. Today they can only turn Privacy mode on by going to Settings, or by knowing the keyboard shortcut. They want a control that is always in the sidebar, in the same place on every screen, that turns Privacy mode on with one click or tap and shows plainly that it is off.

**Why this priority**: This is the whole request. Hiding the money has to be as quick as the glance of a stranger, and a switch buried in Settings does not protect anyone. It works on its own: even if nothing else changes, one visible control that turns the mode on fixes the problem.

**Independent Test**: With Privacy mode off, open any screen of the unlocked app, find the privacy control in the sidebar without opening Settings, press it, and confirm every amount on the screen is masked and the control now says the mode is on.

**Acceptance Scenarios**:

1. **Given** the unlocked app with Privacy mode off, **When** the person looks at the sidebar on any screen, **Then** a Privacy mode control is there, in the same place, saying in words that the mode is off.
2. **Given** Privacy mode is off, **When** the person presses the control (click, tap, or Enter or Space from the keyboard), **Then** Privacy mode turns on at once on the whole screen, with no reload and no visit to Settings.
3. **Given** Privacy mode is on, **When** the person looks at the control, **Then** it says in words that the mode is on, with a different icon from the off state.
4. **Given** Privacy mode is on, **When** the person presses the control, **Then** Privacy mode turns off and the amounts show again.
5. **Given** a narrow window where the navigation is a drawer, **When** the person opens the drawer, **Then** the same labelled control is in it, with the same states and behavior.
6. **Given** a narrow window, **When** the person looks at the top bar, **Then** a compact icon-only switch is there without opening the drawer, showing the state with its icon and an accessible name, and one tap turns the mode on or off.

---

### User Story 2 - Always see which state Privacy mode is in (Priority: P1)

A person wants to know at a glance whether the money on their screen is hidden, without opening anything and without relying on colour alone. The control shows the current state in words and an icon, and a screen reader announces the state and what pressing it will do.

**Why this priority**: A control that only appears when the mode is on (as today) leaves the "off" state invisible, so a person cannot tell whether they are protected. Showing both states is what makes the switch trustworthy.

**Independent Test**: Turn the mode on and off by each route (the control, the shortcut, Settings, the command palette) and confirm the control always matches the real state; check it with a screen reader and with a keyboard only.

**Acceptance Scenarios**:

1. **Given** Privacy mode is turned on or off by any route (the sidebar control, the keyboard shortcut, Settings, or the command palette), **When** the person looks at the sidebar, **Then** the control shows the new state at once.
2. **Given** a screen reader, **When** it reaches the control, **Then** it announces a switch or toggle button named "Privacy mode" together with its state (on or off), and the change is announced politely when the state changes, without moving focus.
3. **Given** only a keyboard, **When** the person tabs through the sidebar, **Then** the control is reachable in a sensible place (with the other utility controls, near Help and Lock) and shows a visible focus indicator.
4. **Given** the light and dark themes and any primary color, **When** the control is shown, **Then** its text and icon are readable and the on and off states differ by words and icon, not by colour alone.
5. **Given** any language the app offers, **When** the control is shown, **Then** its words are in that language and a long translation does not clip or overlap.

---

### User Story 3 - Settings and shortcut keep working (Priority: P2)

Nothing that exists today is taken away. The Privacy mode switch in Settings, the keyboard shortcut and the command palette commands keep working and stay in step with the new sidebar control.

**Why this priority**: The sidebar control is an addition, not a replacement. People who already use Settings or the shortcut must not lose them, but the feature works without verifying this, so it is P2.

**Independent Test**: Change the mode from each place in turn and confirm all the others reflect it; confirm the old "turn off" button is now the same control, not a second one.

**Acceptance Scenarios**:

1. **Given** the Settings switch, **When** the person turns Privacy mode on there, **Then** the sidebar control shows it on, and the reverse.
2. **Given** the shortcut, **When** the person presses it, **Then** the sidebar control changes with the mode.
3. **Given** the sidebar, **When** the person looks for the old "Privacy mode on" button, **Then** there is exactly one privacy control, which is the new one, and it never shows twice.
4. **Given** the app is locked, **When** the lock screen is shown, **Then** no privacy control is shown and nothing about the mode can be changed from it.

---

### Edge Cases

- **Locked app**: the control does not exist on the lock screen or before sign-in; it appears only in the unlocked shell, and a lock removes it.
- **Narrow window or drawer**: the labelled control is inside the drawer, and choosing it does not close the drawer, so the person can see the amounts change; the compact top-bar switch is shown only while the navigation is a drawer, and a very narrow window does not clip either of them or the menu button.
- **Both controls at once**: the drawer's control and the top-bar switch always show the same state, and the top-bar switch is never shown together with the sidebar's own control in a wide window.
- **Desktop app window frame**: the control is placed the same way in the desktop app and in a browser.
- **Rapid presses**: pressing the control several times quickly ends in the state the last press chose, and the state shown always matches the real state.
- **Revealed amounts**: turning the mode on or off by the control hides every revealed amount again, as it does by any other route.
- **Keyboard focus**: pressing the control keeps keyboard focus on it, also after the state changes.
- **Reduced motion**: switching the state shows no animation when reduced motion is on.
- **Larger text and long translations**: the label stays readable and wraps or shortens without overlapping the neighbouring controls.
- **Sync status and badges**: the control does not take the place of, or hide, the sync status, the schedule count badge or Help.
- **First launch after the update**: Privacy mode stays as the person left it (off for a new device); showing the control does not change the mode.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The unlocked app MUST show a Privacy mode control in the sidebar on every screen, in both states of the mode (on and off), so that the mode can be turned on without opening Settings.
- **FR-002**: Pressing the control (click, tap, Enter or Space) MUST turn Privacy mode on when it is off and off when it is on, at once and on the whole screen, with no reload.
- **FR-003**: The control MUST state the current mode in words and an icon, and the on and off states MUST differ by words and icon, not by colour alone.
- **FR-004**: The control MUST be exposed to assistive technology as a switch or toggle named "Privacy mode" with its state, MUST announce state changes politely without moving focus, and MUST be reachable and operable with the keyboard alone, with a visible focus indicator.
- **FR-005**: The labelled control MUST appear in the same place, with the same states and behavior, in the narrow-window navigation drawer, and pressing it there MUST NOT close the drawer.
- **FR-005a**: While the navigation is a drawer (a narrow window), a compact icon-only switch MUST also be shown in the top bar, without opening the drawer, showing the current state by its icon and an accessible name that includes the state, and turning the mode on or off with one press. It MUST NOT be shown in a wide window, where the sidebar already carries the control.
- **FR-006**: Every privacy control (sidebar, drawer, top bar) MUST show the real state however the mode was changed (the control itself, the keyboard shortcut, the Settings switch, or the command palette), and changing the mode by the control MUST update the Settings switch.
- **FR-007**: There MUST be exactly one privacy control in the navigation (the sidebar and its drawer share it), and at most one compact top-bar switch, only on narrow windows; the earlier button that appeared only while the mode was on is replaced by these, not kept beside them.
- **FR-008**: No privacy control (sidebar, drawer or top bar) MUST appear or be usable while the app is locked or before sign-in.
- **FR-009**: The control MUST follow the current light or dark theme and primary color, and pass the product's existing accessibility checks in both themes and at narrow and wide widths.
- **FR-010**: All new or changed text MUST exist in English, Ukrainian and Polish and follow the language chosen in the app, and a long translation MUST NOT clip or overlap neighbouring controls.
- **FR-011**: Turning the mode on or off by the control MUST behave exactly as by any other route: revealed amounts are hidden again, the setting is stored on this device only, and nothing is sent anywhere.
- **FR-012**: The controls MUST NOT hide, replace or move the sync status, the schedule badge, Help, Lock or the menu button, and the top-bar switch MUST NOT crowd the menu button or the page title at the narrowest supported width.
- **FR-013**: The Privacy mode switch in Settings, the keyboard shortcut and the command palette commands MUST keep working unchanged.

### Key Entities

- **Privacy mode control**: the always-visible control, in the sidebar and its drawer (labelled) and in the narrow-window top bar (compact, icon only), that shows whether Privacy mode is on or off and turns it on or off. It holds no data of its own; its state is the existing device preference.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From any screen of the unlocked app, in a wide window and in a narrow one, a person can turn Privacy mode on with one action (a click, tap or key press on the sidebar control or the top-bar switch, with no menu opened first) and every amount on screen is masked within 1 second.
- **SC-002**: In 100% of tested changes, the sidebar control shows the same state as the Settings switch, whichever route changed the mode.
- **SC-003**: A privacy control is present in both states of the mode on every main screen: the sidebar in a wide window, and the top-bar switch and the drawer in a narrow one, in 100% of checked screens.
- **SC-004**: A person using only a keyboard, and a person using a screen reader, can find the control, learn the current state, change it, and hear the new state without help.
- **SC-005**: The control passes the product's accessibility checks in light and dark themes, at narrow and wide widths, with reduced motion, in English, Ukrainian and Polish.
- **SC-006**: No other navigation item (sync status, schedule badge, Help, Lock) loses its place or label because of the control, at narrow and wide widths and at larger text size.

## Assumptions

- The labelled control lives in the sidebar footer with the other utility controls (sync status, Help, Lock), and in the same sidebar content inside the narrow-window drawer, as the earlier "Privacy mode on" button did; the compact switch sits in the top bar next to the menu button. The exact order is a design detail, decided so that it is easy to reach and does not displace Help or Lock.
- The sidebar control is a single switch-like item whose label is "Privacy mode" with the current state, for example "Privacy mode: off" and "Privacy mode: on", with an eye icon for off and a crossed-out eye icon for on; the exact wording is a design detail.
- The Settings switch, the shortcut, the command palette commands and the notification settings are unchanged; the stored preference is the same one, so no data or migration is involved.
- This amends the earlier decision (spec 016, FR-011) that the indicator appears only while the mode is on: the control is now shown in both states.
- This builds on spec 016 (Privacy mode), which this branch starts from: the preference, the shortcut, the Settings switch and the palette commands all come from it, and this feature changes only where and how the switch is shown.
- "Narrow window" means the width at which the navigation becomes a drawer, below 1024 px (the existing `lg` breakpoint); at 1024 px and wider the sidebar is always shown and the top-bar switch is not.
- The desktop app and the web app share the control; nothing in the desktop shell changes.
- The control does not reveal anything about amounts and needs no new permission, network request or dependency.
- Privacy mode itself (what is hidden, the reveal behavior, notifications) is out of scope and is not changed by this feature.
