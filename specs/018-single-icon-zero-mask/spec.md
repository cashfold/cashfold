# Feature Specification: One App Icon and Plain Zeros in Privacy Mode

**Feature Branch**: `018-single-icon-zero-mask`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "We have two issues to fix, first one is related to the application icon, we should remove all the logic related to change the icon of the app, we should have one icon as we had before. Also we should fix the issue with privacy mode. Currently in privacy mode we have strange numbers formatting. When we turn on privacy mode numbers should just be replaced with zeros and blur them, nothing else should be changed"

## Clarifications

### Session 2026-11-01

- Q: With Privacy mode on, should a hidden amount still show its minus or plus sign and its gain/loss colour? → A: Yes, keep both: the sign and the colour stay exactly as with the mode off.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hidden amounts are the same amounts with every digit as a zero (Priority: P1)

A person turns on Privacy mode. Every money amount stays exactly as it is laid out today (its sign, its thousands and decimal marks, its currency code, its place in the row or table), but each digit is shown as a zero and the whole figure is blurred. A balance of "-1,234.56 USD" reads as a blurred "-0,000.00 USD", and "7.50 EUR" as a blurred "0.00 EUR". Nothing else on the screen changes because the mode is on.

Today a hidden amount is a single fixed pattern, the same for every figure, whatever its size or sign. People find it strange: lists and tables look different from the real ones, and the pattern does not look like the amount it replaces.

**Why this priority**: It is the part of the request that changes what people see every time they use Privacy mode, and it works on its own.

**Independent Test**: With a few accounts and transactions of different sizes, signs and currencies, turn Privacy mode on and read every screen: each hidden amount has the same length, sign, separators and currency as the real one, every digit is a zero, and the figure is blurred. Turn the mode off and the real figures return.

**Acceptance Scenarios**:

1. **Given** Privacy mode is off and an amount shows "1,234.56 USD", **When** the person turns the mode on, **Then** that place shows a blurred "0,000.00 USD": the same length and marks, every digit a zero.
2. **Given** a negative amount and a positive amount, **When** the mode is on, **Then** each keeps its own sign, and no digit other than zero is readable in either.
3. **Given** amounts in different currencies and with different numbers of decimals, **When** the mode is on, **Then** each keeps its own currency code and decimal places.
4. **Given** a language that writes numbers with other marks (for example a comma for decimals and a space for thousands), **When** the mode is on, **Then** the hidden amount uses that language's marks, as the real one does.
5. **Given** a hidden amount, **When** the person reveals it as today (click, tap, Enter or Space), **Then** the real figure shows for the same few seconds as before and then hides again.
6. **Given** the mode is on, **When** a screen reader reads an amount, **Then** it says that the amount is hidden and does not read any digit, as today.
7. **Given** the mode is on, **When** the person looks at colours, icons, charts, names, dates and layout, **Then** they are the same as with the mode off, except that figures are zeros and blurred.

---

### User Story 2 - The app has one icon, the original (Priority: P1)

A person who uses Cashfold sees the same single icon everywhere (browser tab, installed web app, the desktop app's window, Dock or taskbar, and any place that offers the app's icon). It does not change when the person changes the app's primary color. It is the original icon the app had before icons followed the primary color.

**Why this priority**: It removes a behaviour the owner does not want, and it removes the work and the files that kept the icon in step with the color. It is independent of the Privacy mode change.

**Independent Test**: Pick each primary color in turn and look at every place the icon appears: it is always the original icon. Search the settings and the help for any mention of the icon changing: there is none.

**Acceptance Scenarios**:

1. **Given** the app uses any primary color, **When** the person looks at the browser tab, the installed app and the desktop window, Dock and taskbar icons, **Then** all show the one original icon.
2. **Given** the person changes the primary color, **When** the change is applied, **Then** the app's colors change as today and no icon changes.
3. **Given** the person opens Settings → Appearance, **When** they look at the primary color setting, **Then** there is no note or option about the icon.
4. **Given** a person who chose a color under the old behaviour, **When** they open the app after this change, **Then** their color is still applied, and the icon is the original one.
5. **Given** the app is installed on a device with the colored icon from before, **When** the person opens it after this change, **Then** the app itself shows the original icon, and the device's own copy of the old icon is not something the app can or must change.

---

### Edge Cases

- A very large amount, an amount with no decimals, and a zero amount: each keeps its own length and marks; a zero amount still reads as zeros.
- An amount with a plus sign (a gain shown with "+"): the sign stays.
- Amounts in places that can only hold plain text (a tooltip, a chart value, a label read by a screen reader): they show the same zeros pattern or, for a reader, that the amount is hidden; no real digit appears in any of them.
- An amount that is revealed and then hidden again returns to the zeros and the blur with no flicker of the real figure.
- The blur still covers large figures as well as small ones, and scales with the text size.
- Exports, backups, and the add and edit forms always show real figures, as today.
- The primary color setting, and everything else that is not the icon, keep working as before.
- Users who had synced a color across devices keep the color; only the icon part goes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: With Privacy mode on, every money amount MUST be shown with each digit replaced by a zero and the whole figure blurred.
- **FR-002**: A hidden amount MUST keep the length, sign, thousands and decimal marks, number of decimals and currency code of the real amount, in the person's language.
- **FR-003**: Nothing about an amount other than its digits MUST change because Privacy mode is on: its sign, its gain-and-loss colour, layout, alignment, icons and surrounding text stay as with the mode off.
- **FR-004**: No digit other than zero MUST appear for a hidden amount anywhere a person or a screen reader could read it: in the visible text, labels, titles, descriptions, tooltips, chart values or what is copied.
- **FR-005**: Revealing one amount, hiding it again, the five-second timing, the screen-reader announcement ("hidden amount") and every rule about when revealed amounts hide again MUST work as they do today.
- **FR-006**: Exports, backups, and the add and edit forms MUST keep showing real figures.
- **FR-007**: The app MUST have one icon, the original one the app had before the icon followed the primary color, in the browser, the installed web app, and the desktop app (window, Dock, taskbar, installer and update screens).
- **FR-008**: Changing the primary color MUST NOT change any icon, and the app MUST NOT offer, describe or announce an icon that follows the color.
- **FR-009**: Everything that existed only to make the icon follow the color MUST be removed, including its settings text, per-color icon files, code and tests, in all supported languages, so no unused icon variant is shipped.
- **FR-010**: A color a person already chose MUST keep working, on this device and across their devices, and nothing the person stored MUST need to be migrated or deleted.
- **FR-011**: The Help, the documentation and the specification of the earlier features MUST no longer say that the icon follows the color or that Privacy mode shows a fixed pattern.

### Key Entities

- **Hidden amount**: the visual stand-in for one money amount while Privacy mode is on. It has the shape of the real amount (length, sign, marks, decimals, currency code), its digits are all zeros, and it is blurred. It carries no information about the real digits.
- **App icon**: the single image that stands for Cashfold in the browser, the installed app and the desktop app. It does not depend on any setting.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a check of every main screen with Privacy mode on, 100% of hidden amounts have the same length, sign, marks and currency code as the real ones, and 0% show a digit other than zero in the page text, labels, titles or chart values.
- **SC-002**: A person looking at a screen with Privacy mode on and then off sees no difference except the figures, in 100% of the main screens checked.
- **SC-003**: Across every primary color offered, 100% of the places the icon appears show the same icon.
- **SC-004**: The Settings → Appearance screen and the Help contain no mention of the icon changing with the color, in any of the three languages.
- **SC-005**: People who had chosen a color keep it: 100% of devices with a stored color show that same color after the change, with no action from the person.
- **SC-006**: The size of the shipped app does not grow, and the files kept only for the colored icons are no longer shipped.

## Assumptions

- "Strange numbers formatting" refers to the current hidden amount being one fixed pattern (the same zeros for every figure, with no sign), which does not look like the amount it stands for. The fix is for the hidden amount to look like the real amount with every digit as a zero.
- This deliberately reverses the earlier decision (spec 016) that a hidden amount is a fixed pattern that does not show the size of the figure. A hidden amount now shows how many digits and which sign the real amount has, because the owner asked for nothing but the digits to change. The blur and the zeros still hide the digits themselves.
- The sign and the gain-and-loss colour stay as with the mode off (confirmed in the 2026-11-01 clarification).
- The "original icon" is the one the app shipped before the icon followed the primary color (spec 014). The primary color setting itself stays.
- Screen-reader behaviour, the reveal rules and Privacy mode's switch, shortcut and palette commands are unchanged.
- Icons already installed on a device from the colored versions are copies the system holds. The app cannot change them, and a person gets the original only by reinstalling.
- Releasing and changelog handling follow the project's usual process.
