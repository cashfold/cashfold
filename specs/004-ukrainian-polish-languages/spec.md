# Feature Specification: Ukrainian and Polish Languages

**Feature Branch**: `004-ukrainian-polish-languages`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "currently we support only english language, but I want to have at least two additional languages to support Ukrainian and Polish"

## Clarifications

### Session 2026-10-25

- Q: Should "Fold" stay as "Fold" in Ukrainian and Polish, or get a local word? → A: A local word in both languages, chosen once by the native reviewers.
- Q: Can the new languages be offered before a native speaker has reviewed all the text? → A: Yes. They are offered from the first release; the native review continues after it and its fixes ship as ordinary updates.
- Q: Should starter names the app creates (such as the personal Fold) be in the person's language or always English? → A: In the language chosen at creation, then kept as the person's own text.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use the whole app in Ukrainian or Polish (Priority: P1)

A person whose browser or device is set to Ukrainian or Polish opens the app and sees every screen, message, label, error and notice in that language, from first run and sign-up through the daily screens (overview, transactions, accounts, plan, settings) to sharing, devices and emergency kit. Dates, numbers, currency amounts and plurals follow that language's conventions.

**Why this priority**: This is the feature. Without a complete translation, the extra languages add little value and mixed-language screens look broken.

**Independent Test**: Set the browser language to Ukrainian, then to Polish, walk through every route, and confirm no English text remains and counts such as "1 / 2 / 5 entries" use the correct plural form.

**Acceptance Scenarios**:

1. **Given** a browser whose preferred language is Ukrainian, **When** a new visitor opens the app, **Then** the sign-up screen and every later screen appear in Ukrainian.
2. **Given** a browser whose preferred language is Polish, **When** a person unlocks the app, **Then** the unlock screen, the shell, and all pages appear in Polish.
3. **Given** a count of 1, 2, 5 and 22 items, **When** a message shows the count, **Then** the wording uses the correct grammatical form for the chosen language.
4. **Given** a transaction of 1 234,56 in any currency, **When** it is displayed or typed, **Then** the formatting and parsing follow the chosen language's number and date conventions and the amount is still exact.
5. **Given** a new person creating an account while the app is in Polish, **When** the account is created, **Then** the personal Fold and the default categories have Polish names, and switching the language later leaves those names unchanged.

---

### User Story 2 - Choose the language in the app (Priority: P2)

A person can pick English, Ukrainian or Polish (or "Automatic", which follows the browser) from the settings, independent of the browser language, and the choice is remembered on that device. Before sign-in, the language can also be changed, so someone whose browser is in English can still read the sign-up and unlock screens in their own language.

**Why this priority**: Browser language is often not the language a person wants (shared devices, work laptops). Detection alone covers the common case, so this follows the translation itself.

**Independent Test**: With an English browser, switch to Polish in settings, reload, and confirm the app stays in Polish; switch back to English and confirm the same.

**Acceptance Scenarios**:

1. **Given** the app is in English, **When** the person selects Ukrainian, **Then** the visible text changes immediately without losing their place or unsaved input.
2. **Given** a person chose Polish, **When** they reload or return later on the same device, **Then** the app opens in Polish, whatever the browser language.
3. **Given** the unlock or sign-up screen, **When** the person opens the language choice, **Then** they can change the language without being signed in.
4. **Given** each language in the list, **When** it is shown, **Then** it is written in its own language ("English", "Українська", "Polski") so it can be found even when the current language is unreadable to the person.

---

### User Story 3 - Keep translations complete as the app grows (Priority: P3)

When a new screen or message is added, the team is told if it lacks a Ukrainian or Polish version, so translations never silently fall back to English in a released build.

**Why this priority**: Protects the value of P1 over time, but is not user-visible on day one.

**Independent Test**: Add a message in English only and confirm the project's checks flag the missing Ukrainian and Polish entries.

**Acceptance Scenarios**:

1. **Given** a message exists in English but not in Ukrainian or Polish, **When** the project's checks run, **Then** they fail and name the missing entries in each language.
2. **Given** a translation uses different placeholders than the English original, **When** the checks run, **Then** they fail and point to the entry.

---

### Edge Cases

- A browser lists several languages (for example Russian, then Polish): the first supported one in the person's preference order is used; unsupported languages are skipped, and English is the last resort.
- A regional variant such as `pl-PL` or `uk-UA` resolves to the base language.
- A person with a saved language choice later opens the app in a browser with a different language: the saved choice wins.
- Long Ukrainian and Polish words and phrases do not truncate, overlap or break the layout on a phone-width screen, in dialogs, buttons, tables and the sidebar.
- Messages produced outside the page (user-facing errors, the emergency kit, the desktop app's menus and start-up error dialog) are also translated; the installed-app name stays the brand and its description is language-neutral.
- Amounts typed with an ordinary space as the thousands separator, or with a dot as the decimal mark, are accepted and parsed exactly; an ambiguous entry that mixes both (such as `1.234,56` where the dot is not the group mark) is rejected with a clear message.
- CSV exports keep fixed, language-independent column headers; only the app's screens change language.
- Text the person typed (account names, notes, tags) is never translated or altered.
- Ukrainian uses the Cyrillic script and Polish has diacritics: both display correctly in all fonts the app bundles, including in exports and the emergency kit.
- Sorting and searching of names respects the chosen language (for example Polish "Ł" and Ukrainian "Ї" sort in their proper alphabetical place).
- A key missing from a language still shows English rather than a blank or a raw key, but this must not occur in a released build (see User Story 3).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST be fully available in Ukrainian and in Polish, in addition to English, covering every user-visible string on every screen, dialog, notice, validation message and error.
- **FR-002**: The app MUST pick the initial language from the person's preferred languages, honouring their order, resolving regional variants to the base language, and falling back to English.
- **FR-003**: The person MUST be able to choose the language manually, both before and after sign-in, with each language listed under its own name.
- **FR-004**: The chosen language MUST persist on the device and take priority over the browser's language until changed. The person MUST also be able to choose "Automatic" to go back to following the browser's preferred languages.
- **FR-005**: Changing the language MUST apply at once and MUST NOT lose the person's place or unsaved input, and MUST NOT require signing in again.
- **FR-006**: Messages with counts MUST use the correct plural forms for each language, including Ukrainian's and Polish's separate forms for one, few, many and other.
- **FR-007**: Dates, times, numbers and currency amounts MUST be displayed in the chosen language's conventions, and amounts typed by the person MUST be accepted in those conventions and parsed exactly.
- **FR-008**: The document language MUST reflect the chosen language, so screen readers pronounce text correctly. The page title is the brand name "Cashfold" and is the same in every language.
- **FR-009**: Surfaces outside the main pages MUST follow the chosen language wherever the platform allows it: user-facing errors (produced on the device from error kinds, never as server text), exported documents such as the emergency kit, and the desktop app's own menus. The desktop start-up error dialog, shown before any window exists, follows the operating system's language. The installed-app name is the brand and its description is language-neutral, because a static web app cannot vary either per person. CSV export keeps fixed column headers so files stay readable by other tools and by import.
- **FR-010**: User-entered data MUST never be altered by a language change.
- **FR-011**: Layouts MUST remain usable with the longer text of both languages at all supported screen sizes, with no clipped or overlapping content.
- **FR-012**: Product terms (Fold, Account, Transaction, Transfer and the like) MUST use one agreed translation per language, applied consistently on every screen, including a local-language word for "Fold" (it is not left in English).
- **FR-013**: The project's checks MUST fail when a message lacks a Ukrainian or Polish translation or when a translation's placeholders differ from the original.
- **FR-014**: The existing languages and right-to-left support MUST keep working unchanged.
- **FR-015**: Starter names the app creates for a new person (such as the personal Fold and default categories) MUST be written in the language chosen at that moment and afterwards treated as the person's own text: never retranslated, never changed by a later language switch.

### Key Entities

- **Language**: A language the app offers (English, Ukrainian, Polish), with its own display name, text direction, and number, date and plural conventions.
- **Translation set**: The complete collection of user-visible text for one language, keyed identically to the English set.
- **Language preference**: The person's saved choice on a device, which overrides detection.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of user-visible text is available in Ukrainian and in Polish; a walk through every route in each language finds no English text.
- **SC-002**: A person can switch language from the settings, or from the sign-in screens, in no more than 3 interactions and sees the result in under 1 second.
- **SC-003**: 100% of count-based messages show the right plural form in a check with the values 0, 1, 2, 5, 12, 22 and 100 in each language.
- **SC-004**: In each language, no text is clipped or overlapping at a 320 px wide screen and at desktop width on every screen.
- **SC-005**: The saved language survives a reload, and a browser-language change does not override it, in 100% of checks.
- **SC-006**: A translation gap or a placeholder mismatch introduced in a change is caught before release in 100% of cases.
- **SC-007**: Within one release cycle after the languages are first offered, one native Ukrainian speaker and one native Polish speaker have reviewed every screen and given written sign-off that the wording is natural and the finance terms are correct; every issue they raise is fixed or tracked, and until sign-off the release notes list the review as open.

## Assumptions

- The three languages offered after this work are English, Ukrainian and Polish; "at least two additional" is met by those two, and the design must make a further language a matter of adding a translation set.
- The word chosen for "Fold" in each language is proposed before drafting (tasks) and confirmed by the reviewers; if they replace it after release, a one-time rename of that term across the catalogue is accepted as the cost of shipping early.
- Ukrainian and Polish are offered from the first release even though native-speaker review (SC-007) may still be in progress; the glossary terms are agreed before the full text is drafted, and reviewer corrections ship as normal updates. A machine draft is acceptable as a starting point.
- Language detection uses the browser's preferred languages, and the saved choice is stored on the device only; it is not synced between devices or part of the encrypted ledger.
- The existing placeholder Arabic set (empty, layout only) is left as is and is not part of this work.
- Starter names created at first run follow FR-015; existing e2e specs that expect the English name "Personal" keep running under an English browser.
- Currency codes and symbols follow the currency, not the language; only their formatting follows the language.
- Legal text, help pages and release notes that live outside the app are out of scope unless they are shown inside it.
