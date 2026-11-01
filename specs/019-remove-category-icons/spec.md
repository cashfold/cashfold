# Feature Specification: Categories Without Icons

**Feature Branch**: `019-remove-category-icons`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "Remove icons from categories. Categories keep only their color. The Categories screen currently shows an emoji next to each category name, and the category form has an Icon dropdown. Remove both, so a category is a name and a color, and nothing in the app shows an emoji."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A category is a name and a color (Priority: P1)

A person opens Settings → Categories. Each category shows its color swatch and its name, with no emoji beside them. When they add or edit a category, the form asks for a name and a color and nothing else: there is no Icon field. Everything else about categories (parents and children, archiving, merging, moving, deleting) works as before.

Today the list shows an emoji next to each name and the form has an Icon dropdown whose options also start with an emoji. Emoji look different on every system and clash with the rest of the interface, and the color already does the job of telling categories apart at a glance.

**Why this priority**: It is the whole request. Without it, the app still draws emoji.

**Independent Test**: Open Settings → Categories with the default categories and with a category that was given an icon before this change. No emoji appears in any row. Open the add and edit forms: there is no Icon field. Create a category with a name and a color, edit it, and see only those two things.

**Acceptance Scenarios**:

1. **Given** the default categories made at sign-up, **When** the person opens Settings → Categories, **Then** each row shows a color swatch and the name, and no emoji.
2. **Given** a category that had an icon before this change, **When** the person opens the list, **Then** it looks like any other row: swatch and name only.
3. **Given** the add or edit category form, **When** the person looks at it, **Then** it has a name, a color and the usual choices (type, parent), and no Icon field or Icon dropdown.
4. **Given** a person creates a category with a name and a color, **When** they save it, **Then** it appears in the list with that color and name and works in transactions, budgets and filters as before.
5. **Given** a category with a long name or one that is archived, **When** the list is shown, **Then** the row still lines up and the name is still truncated or badged as before, without a gap where the emoji used to be.

---

### User Story 2 - No emoji drawn by the app (Priority: P2)

A person using the app on any screen sees no emoji that the app itself draws. People can still type emoji in names and notes they write themselves, and those are shown as typed.

**Why this priority**: It is the second half of the request ("nothing in the app shows an emoji"), but the category icons are the only place the app draws emoji today, so it is satisfied by Story 1 and only needs to be kept true.

**Independent Test**: Walk through every main screen, dialog and menu in English, Ukrainian and Polish, with the default data. No emoji appears that the person did not type.

**Acceptance Scenarios**:

1. **Given** the app with its default data, **When** the person visits every main screen, **Then** no emoji appears anywhere.
2. **Given** a person who typed an emoji in an account name, **When** the account is shown, **Then** the emoji is shown as typed, because it is their text.
3. **Given** the app in a language other than English, **When** the person opens Settings → Categories and the add form, **Then** there are no leftover strings about icons.

---

### Edge Cases

- A category created on another device before this change, with an icon, syncs here: it appears without an icon, and nothing fails.
- A category created on a device that has not yet updated, with an icon, syncs to an updated device: same, it appears without an icon.
- Backups made before this change restore correctly, and the icon in them is ignored.
- Exports: if exports include a category's icon, the field is no longer written (or is written empty), and importing an older export that has an icon still works.
- A category list that is long or on a narrow window: the color swatch and name keep their spacing, and nothing shifts sideways.
- Screen readers: the list reads the category name, as before; no empty or leftover icon element is announced.
- Keyboard use of the form: the tab order has no stop where the Icon field used to be.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Categories list MUST show each category as its color swatch and its name, with nothing in place of the former icon.
- **FR-002**: The add and edit category forms MUST NOT offer an icon: no Icon field, dropdown or "no icon" choice.
- **FR-003**: The default categories created at sign-up MUST be created without an icon.
- **FR-004**: A category that already has an icon MUST keep working, but its icon MUST NOT be shown anywhere, and the person MUST NOT need to do anything.
- **FR-005**: Changing a category's name, color, parent or archive state MUST NOT write or change an icon.
- **FR-006**: Syncing, backups, restores and imports MUST keep working with categories from before this change, with or without an icon, in either direction between updated and not yet updated devices.
- **FR-007**: The app MUST NOT draw any emoji on any screen, dialog, menu, list, notification or export; text a person typed themselves MUST be shown as typed.
- **FR-008**: The text that only existed for category icons (the Icon label, the "no icon" choice and the icon names) MUST be removed from every language the app offers.
- **FR-009**: Everything else about categories (colors, hierarchy, archiving, merging, moving, deleting, use in transactions, budgets, schedules and filters) MUST work as before.
- **FR-010**: The category list and form MUST stay accessible: the keyboard order has no gap, no empty element is announced, and the color remains a swatch beside the name, never the only carrier of meaning.

### Key Entities

- **Category**: a name, a type (income or expense), an optional parent, a color, and an archived state. It no longer has a visible icon. Categories made before this change may carry an icon value that the app keeps and ignores.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On Settings → Categories, with the default categories and with categories that had icons, 0 rows show an emoji or leave a gap where one was.
- **SC-002**: The add and edit category forms have 0 icon controls, in all three languages.
- **SC-003**: Walking every main screen with the default data finds 0 emoji drawn by the app.
- **SC-004**: 100% of categories that existed before the change still appear, with the same name and color, after the change, with no action from the person.
- **SC-005**: Restoring a backup made before the change, and syncing with a device that has not updated, both succeed with no error and no data loss.
- **SC-006**: Creating a category (name and color) takes no more steps than before, and one fewer field.

## Assumptions

- A category is told apart by its color and name; the icon was decoration and nothing else relied on it, so removing it loses no information.
- This applies to categories only. Accounts have no visible icon today, and other screens use the interface's own line icons, which are not emoji and stay.
- "No emoji" is about what the app draws. Names, notes and other text the person types are theirs and are not filtered.
- Existing stored icon values are left in place and ignored rather than erased, because erasing them would need every device to rewrite every category, and an older device would write them back.
- Categories and their colors are synced as today; no new data is added.
- The set of colors, the color picker and how a color is shown are not part of this change.
