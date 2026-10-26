# Feature Specification: Desktop Native Feel

**Feature Branch**: `007-desktop-native-feel`

**Created**: 2026-10-26

**Status**: Draft

**Input**: User description: "To improve native desktop experience we should disable text selection in desktop application, use the correct cursors etc. Also now we have context actions like: File, Edit, View, Window, Help, we should not have it in application."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No menu bar in the window (Priority: P1)

A person opens the Cashfold desktop app on Windows, macOS or Linux and sees only the app: no File, Edit, View, Window, Help strip across the top of the window. The app's own screens carry every action a person needs. Everything the menus offered that people rely on (copy, paste, undo, zoom, quit) keeps working from the keyboard, and the rest from the app's own controls. The web app is unchanged.

**Why this priority**: It is the most visible way the desktop app still looks like a document viewer rather than a purpose-built app, and removing it changes what the window looks like on every launch.

**Independent Test**: Launch the desktop app on each system. No File, Edit, View, Window or Help menu is shown in or above the window. Press the shortcuts for copy, paste, select all, undo, zoom and quit: each still does what it did before.

**Acceptance Scenarios**:

1. **Given** the desktop app on Windows or Linux, **When** it is launched and the person presses the Alt key, **Then** no menu bar appears at any point.
2. **Given** the desktop app on macOS, **When** it is launched, **Then** the system menu bar shows no File, Edit, View, Window or Help menus; only the minimal items the system itself requires for any app (the app name menu with About, Hide and Quit) remain.
3. **Given** the menu bar is gone, **When** the person uses the keyboard shortcuts that existed before (undo, redo, cut, copy, paste, select all, zoom, close window, minimise, full screen, quit), **Then** each one still works as before.
4. **Given** an action that was only reachable from a menu entry (for example About, checking for updates, showing the data folder, reporting a problem), **When** the person looks for it, **Then** it is reachable from Settings or the tray or menu-bar icon, so no capability is lost.
5. **Given** the app is locked, **When** any shortcut for a data action is used, **Then** nothing happens or the unlock screen is asked for; no data is reached (unchanged).
6. **Given** the app in a browser, **When** it is opened, **Then** it behaves exactly as before.

---

### User Story 2 - Text does not get selected by accident (Priority: P2)

In the desktop app, clicking, dragging or double-clicking on labels, buttons, rows, headings, menus and other interface text never highlights text, as in any native app. Places where a person genuinely needs to read, copy or edit text still allow it: text fields, notes and descriptions being edited, and values that people copy on purpose, such as the Secret Key, the Emergency Kit text, the server address, device codes and error details. Right-click and the keyboard shortcut still copy those.

**Why this priority**: Accidental blue selection highlights are the clearest sign of "a web page in a window", but unlike the menu bar it must be done carefully so nothing a person needs to copy becomes uncopyable.

**Independent Test**: In the desktop app, drag across a screen of labels, rows and buttons: nothing highlights. Double-click a transaction row and a heading: nothing highlights. Select-all outside a field: nothing highlights. Type in a text field, select and copy its text, and copy the Secret Key from the Emergency Kit screen: all work.

**Acceptance Scenarios**:

1. **Given** the desktop app, **When** the person drags across or double-clicks interface text (labels, headings, buttons, tabs, list rows, navigation, balances), **Then** no text is highlighted.
2. **Given** a text input, search box, notes field or any editable area, **When** the person selects text with the mouse or keyboard, **Then** it is selected and can be copied, cut and pasted as usual.
3. **Given** a value meant to be copied (the Secret Key, Emergency Kit text, server address, device pairing details, an error message with details), **When** the person selects it or uses its copy button, **Then** it can be selected and copied.
4. **Given** the person uses select-all while no field is focused, **When** it is pressed, **Then** nothing in the interface is highlighted.
5. **Given** the app in a browser, **When** the person selects text anywhere, **Then** it behaves exactly as before.
6. **Given** the screen is read with assistive technology, **When** text is not selectable with the mouse, **Then** it is still read aloud and focusable exactly as before.

---

### User Story 3 - The pointer says what a thing does (Priority: P3)

In the desktop app, the mouse pointer follows the conventions of a native app rather than a website. Buttons, rows, tabs and other controls that act on click use the normal arrow, not the pointing hand that signals a web link. The text-insertion pointer appears only over editable text and selectable copy-values. Disabled controls show the normal arrow. Draggable areas and resizable edges show the usual move and resize pointers. While something is busy, the busy pointer appears only where the system would show one. Real links that open a page outside the app keep the pointing hand.

**Why this priority**: It completes the native feel but has the smallest effect on what people can do.

**Independent Test**: Hover buttons, tabs, list rows, switches, menu entries, disabled buttons, text fields, a copyable Secret Key, an external link and the window's drag area, and compare the pointer to the expected one for each.

**Acceptance Scenarios**:

1. **Given** the desktop app, **When** the pointer is over a button, tab, switch, list row or any other control that acts on click, **Then** the normal arrow is shown.
2. **Given** a text field or a copyable value, **When** the pointer is over it, **Then** the text-insertion pointer is shown; over non-editable, non-copyable interface text it is the normal arrow.
3. **Given** a disabled control, **When** the pointer is over it, **Then** the normal arrow is shown and it does nothing when clicked.
4. **Given** a link that opens a page outside the app, **When** the pointer is over it, **Then** the pointing hand is shown.
5. **Given** the draggable part of the window frame and any resizable edge, **When** the pointer is over them, **Then** the system's normal pointer for that area is shown, and ordinary controls placed on the frame show the arrow.
6. **Given** the app in a browser, **When** the pointer is over controls, **Then** it behaves exactly as before.

---

### User Story 4 - Other web-page habits are gone (Priority: P4)

Small behaviours that make a desktop window feel like a web page are removed: the browser's own right-click menu (Back, Reload, Inspect and the like) does not appear on interface text; images and icons cannot be dragged out of the window; dragging a file onto an area that does not accept it does nothing instead of navigating away from the app; the page does not rubber-band or scroll as a whole when its content fits; pinch and wheel gestures do not zoom the page unless the person uses the app's own zoom. Where the app already has its own right-click menu (for example on a transaction), it keeps working, and text fields keep the usual Cut, Copy, Paste menu.

**Why this priority**: It polishes the finish, and each piece is small and independent. It is listed last because people notice it least.

**Independent Test**: Right-click empty space, a title and a toolbar: no browser menu. Drag an icon: it does not move. Drop a file on a non-accepting area: nothing happens and the app stays where it is. Scroll a short screen: nothing bounces.

**Acceptance Scenarios**:

1. **Given** the desktop app, **When** the person right-clicks interface text or empty space, **Then** no website-style menu appears.
2. **Given** a text field, **When** the person right-clicks it, **Then** the usual Cut, Copy, Paste, Select all menu is offered, in the language the app is shown in.
3. **Given** a transaction or account row that offers its own right-click menu, **When** it is right-clicked, **Then** that menu opens as before.
4. **Given** an icon, logo or image in the interface, **When** the person tries to drag it, **Then** it does not move or ghost-drag.
5. **Given** a file is dropped on an area that does not accept files, **When** the drop happens, **Then** nothing happens and the app does not navigate or show the file.
6. **Given** a screen whose content fits the window, **When** the person scrolls or swipes, **Then** the whole page does not move or bounce.
7. **Given** the app in a browser, **When** any of the above is tried, **Then** it behaves exactly as before.

---

### Edge Cases

- A person relies on a menu entry the app no longer shows: each such action stays reachable from Settings or the tray or menu-bar icon (US1-4), so nothing is lost.
- Screen readers and keyboard navigation: removing the menu bar and selection highlights must not remove focus rings, tab order or spoken text.
- A value that was selectable today but is not on the "copy on purpose" list: a person can still copy it through the row's own action or from the field it is shown in; if neither exists, it is added to the list in this release.
- A field that is read-only (such as a locked amount): its text remains selectable and copyable.
- Right-to-left or very large text sizes: unchanged.
- A third-party or embedded page shown inside the window (for example the Help site opened inside the app, if any): treated as web content and not restricted.
- Text selection inside the web app opened in a browser, including on a desktop computer: unchanged; only the packaged desktop app changes.
- Linux desktops that show a global menu: no global menu entries are exposed for the app beyond what the system itself adds.
- Dragging a file onto the import area or the add-transaction receipt area keeps working as defined by earlier work (if present), and a dropped file never replaces the app's content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The desktop app MUST NOT show a File, Edit, View, Window or Help menu on any supported system, and on Windows and Linux MUST NOT show any menu bar, including when the Alt key is pressed.
- **FR-002**: On macOS the only application-menu items shown MUST be those the system requires for any app (the app name menu with About, Hide, Hide Others and Quit); no other top-level menus are shown.
- **FR-003**: Every keyboard shortcut that worked while the menus existed (undo, redo, cut, copy, paste, select all, zoom, close window, minimise, full screen, quit) MUST keep working with the same keys. Shortcuts for app actions (new transaction, lock, Settings, search, sections, import, export) are defined by the native-desktop work (006); they never depended on a menu here and are delivered there without one.
- **FR-004**: Every action that was reachable only through a menu entry and that a person can reasonably need (About, check for updates, open the data folder, report a problem, quit) MUST remain reachable: the first four from Settings, and quit from its shortcut and, on macOS, the app-name menu. Until the tray or menu-bar icon exists, quit has no on-screen control on Windows and Linux.
- **FR-005**: While the app is locked, any shortcut or entry point for an app action that reaches data MUST do nothing or lead to the unlock screen; it MUST NOT reveal or change data. Clipboard, window and quit shortcuts are not data actions.
- **FR-006**: In the desktop app, interface text (labels, headings, buttons, tabs, navigation, list rows, balances, badges) MUST NOT be selectable by mouse, touch, double-click, triple-click or select-all.
- **FR-007**: Text fields, editable areas and read-only fields MUST keep full selection, copy, cut (where editable) and paste behaviour.
- **FR-008**: A defined set of copy-on-purpose values MUST remain selectable and copyable: the Secret Key, Emergency Kit text, server address, device pairing details, and the details of error messages.
- **FR-009**: Disabling selection MUST NOT change what assistive technology reads, focus order or keyboard operation.
- **FR-010**: In the desktop app, controls that act on click MUST show the normal arrow pointer, not the pointing hand.
- **FR-011**: The text-insertion pointer MUST appear only over editable text and copy-on-purpose values.
- **FR-012**: Disabled controls MUST show the normal arrow pointer and MUST NOT react to clicks.
- **FR-013**: Links that open a page outside the app MUST keep the pointing hand.
- **FR-014**: The window's drag area and resizable edges MUST show the system's own pointers, and controls placed on the drag area MUST show the arrow and stay clickable.
- **FR-015**: The browser-style right-click menu MUST NOT appear on interface text; text fields MUST offer the usual Cut, Copy, Paste and Select all menu in the language the app is shown in; rows that already have their own menu MUST keep it.
- **FR-016**: Images, icons and logos in the interface MUST NOT be draggable.
- **FR-017**: A file dropped on an area that does not accept files MUST be ignored and MUST NOT navigate the window away from the app.
- **FR-018**: A screen whose content fits the window MUST NOT scroll or bounce as a whole page, and wheel or pinch gestures MUST NOT zoom the page unless done through the app's own zoom.
- **FR-019**: Every requirement above applies only to the packaged desktop app; the web app opened in a browser MUST behave exactly as before.
- **FR-020**: Any new text (for example labels for actions moved into Settings or the tray) MUST exist in English, Ukrainian and Polish.
- **FR-021**: The change MUST NOT alter what is stored, synced or sent, and MUST NOT add new data collection.

### Key Entities

- **Copy-on-purpose value**: a piece of text a person is expected to copy or read out (the Secret Key, Emergency Kit text, server address, device pairing details, error details). It stays selectable and shows the text-insertion pointer.
- **Interface text**: any other text in the app. It is not selectable and shows the arrow.
- **Relocated action**: a menu-only action (About, check for updates, open data folder, report a problem) that now lives in Settings or the tray or menu-bar icon.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of launches on Windows, macOS and Linux, no File, Edit, View, Window or Help menu is visible, and on Windows and Linux none appears when Alt is pressed.
- **SC-002**: 100% of the shortcuts that worked before the change still work with the same keys, and 100% of the relocated actions other than quit can be reached in no more than three clicks from the main screen.
- **SC-003**: Across a checked sweep of every screen in the desktop app, dragging or double-clicking interface text highlights nothing in 100% of cases, while 100% of text fields and copy-on-purpose values can still be selected and copied.
- **SC-004**: In a sweep of every kind of control, 100% show the pointer that matches its role (arrow for actions, text pointer for editable or copyable text, hand only for outside links).
- **SC-005**: A reviewer comparing the desktop app with the web app finds none of the listed web-page habits (browser right-click menu, draggable icons, file-drop navigation, page bounce, page zoom) in the desktop app in 100% of checks.
- **SC-006**: The web app shows no change in selection, pointers, menus or shortcuts in any check.
- **SC-007**: Screen-reader and keyboard-only walk-throughs of the main flows pass with no regression compared to before the change.

## Assumptions

- This change reverses part of the earlier native-desktop work (spec 006), which added the File, Edit, View, Window and Help menu bar: the menu bar is removed here, while its shortcuts and its relocated actions stay.
- "Context actions like File, Edit, View, Window, Help" means the application menu bar, not the right-click menus on rows, which stay.
- Shortcuts keep working without a visible menu: the clipboard, undo, zoom, window and quit shortcuts keep their current keys. App-action shortcuts (new transaction, lock, Settings, search, sections, import, export) were never built on a menu; they are delivered by the native-desktop work (006) as plain shortcuts, with no menu entry.
- On macOS a bare app-name menu cannot be removed by an app, so it is kept minimal; Windows and Linux show no menu at all.
- The copy-on-purpose list is the Secret Key, Emergency Kit text, server address, device pairing details and error-message details; other values are added to it only if found during review.
- "Correct cursors" means native-app conventions: arrow on actions, text pointer on editable or copyable text, hand only on links that leave the app.
- Applies to the packaged desktop app only; the web app in a browser, on any device, is unchanged.
- The existing right-click menus on transaction and account rows, and the file-drop import, are unchanged.
- Out of scope: new shortcuts, new settings to turn selection back on, custom window frame redesign, and any change to stored or synced data.
