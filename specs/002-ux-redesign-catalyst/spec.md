# Feature Specification: Calm, Task-Focused UX and Design-System UI

**Feature Branch**: `002-ux-redesign-catalyst`

**Created**: 2026-10-20

**Status**: Draft

**Input**: User description: "Currently application looks and feels not so good. UX is terrible, a lot of visual noise, fields that can be hidden etc. We should improve UX using the reference docs (docs/reference/reference-app). Also UI looks bad now, we should use the Catalyst UI kit by Tailwind for it (/Users/pogulailo/Downloads/catalyst-ui-kit). All should be described as detailed as it can be."

## Overview

The first release (spec 001) delivered every function of the product, but each screen exposes everything at once. A person who wants to record a coffee sees about fifteen controls. A person who opens the overview sees a period selector, two checkboxes, three headline cards, a net-worth list, two breakdowns, a trend table and a balance chart, all stacked. The top bar carries twelve text links in one wrapping row. Controls look like unstyled browser defaults.

This feature **redesigns how the existing product is organised, revealed and styled**. It does not add domain capabilities. It changes three things:

1. **Information architecture**: fewer, clearer top-level places, with related screens grouped.
2. **Progressive disclosure**: each screen shows what most people need most of the time. Everything else stays one deliberate step away, and nothing is removed.
3. **Visual system**: one consistent, polished component language across every screen, built from the **Catalyst UI kit** (Tailwind's application UI kit), in light and dark appearance.

The functional behaviour, privacy guarantees (end-to-end encryption, offline-first, no third-party scripts), data formats and sync of spec 001 are unchanged. A person who used the previous interface can still do everything they could do before.

### Reference material

Behavioural inspiration comes from a study of an established mobile expense tracker, summarised in `docs/reference/reference-app/` (screens in `01-navigation-and-screens.md`, rules in `02-data-model-and-rules.md`). The patterns taken from it are listed in [Reference Patterns](#reference-patterns-adopted-and-adapted). **Only the interaction ideas are used**: no names, copy, icons, artwork or assets are copied. Features that exist only in that app (paid tiers, its sync service, its icon packs and so on) are out of scope.

### Observed problems in the current interface (baseline)

These are facts about the current build, and the redesign must remove each one.

| # | Area | Problem today |
|---|---|---|
| P-1 | Navigation | 12 equal-weight text links in one wrapping header row (Dashboard, Accounts, Transactions, Transfers, Budgets, Schedules, Goals, Categories, Folds, Data, Devices, Settings). No grouping, no sense of importance, and the row wraps onto several lines on narrow screens. |
| P-2 | Add transaction | One long form with about 15 controls always visible: type, account, amount, date and time, category, payee, a checkbox per existing tag, a "new tag" field, place name, latitude, longitude, "use my location", "clear", note, status, refund, pin and attachment. Rarely used fields (status, raw coordinates, pin, refund) carry the same weight as amount and category. |
| P-3 | Overview | Everything is shown at once: period, adjustments toggle, transfers toggle, summary cards, net worth plus per-account list, spending by category, spending by tag, a monthly trend table, and a day-end balance chart with an account picker. There is no hierarchy, so the most important number does not stand out. |
| P-4 | Transaction list | A filter form with about 9 inputs (text, account, category, status, from, to, min, max, clear) is permanently open above the list. Each row carries separate Edit and Delete buttons. Rows are not grouped by day. |
| P-5 | Settings | One long page of unrelated sections (account, credentials, email, recovery, quick unlock, sync, storage, server address) with no grouping or ordering by importance. |
| P-6 | Visual quality | Controls are default-browser looking: bare selects, radios and checkboxes, unstyled buttons, no spacing rhythm, no icons, no consistent surfaces, tables without styling. Appearance differs between screens. |
| P-7 | Orientation | The page has no persistent sense of "where am I / what is the current Fold / is my data safe": the sync indicator and lock button float in the header among the links. |
| P-8 | Empty and first-run | Many screens show plain text such as "no items" with no guidance on what to do next. |

## Clarifications

### Session 2026-10-20

No blocking questions were raised. The following decisions were made from the request and from the existing product, and are recorded as assumptions below:

- The redesign covers **every existing screen**, including sign-up, sign-in, recovery and the one-time-secret flows.
- The Catalyst kit is the **mandated component foundation**. The visual identity (colour, typography details) may be tuned within it.
- "Hideable fields" means **progressive disclosure plus a per-device preference**, not removal of any capability.
- Q: Should the redesign include new input conveniences such as typing sums in the amount field or an Undo after deleting? → A: No. This is a pure redesign: the amount field accepts a single number, and no new undo is added. The product's existing "Recently deleted" list, from which a deleted transaction can be restored, is kept as it is.
- Q: When the new interface ships, does it fully replace the old one or can people switch back? → A: It fully replaces it. The old interface is removed and there is no classic-layout switch.
- Q: On a phone, does the add-transaction form open as a full page or a sheet? → A: A slide-up sheet with the Save button always visible above the on-screen keyboard; a centred dialog on larger screens.
- Q: Where are categories managed? → A: In Settings, as their own group. The Accounts section holds accounts only.
- Q: Which visual identity does the new look use? → A: Catalyst's structure and components with an emerald accent colour and the Ubuntu typeface, bundled locally. All other tokens follow the kit's defaults.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a transaction in seconds (Priority: P1)

A person has just paid for something and wants to log it before they forget. They open the app, enter the amount, pick a category and save. The default form shows only what is needed. Every other optional detail (payee, tags, place, note, attachment, status, refund, pin) is available behind an explicit "More details" control and is remembered open or closed per device.

**Why this priority**: Adding transactions is the most frequent action in a finance tracker. If it feels heavy, people stop recording, and the product loses its value.

**Independent Test**: With one account and a few categories present, a tester opens the add flow from any screen, types an amount, chooses a category and saves. This can be completed in at most 4 interactions (open, amount, category, save), without scrolling on a phone-sized viewport, and the new transaction appears in the list.

**Acceptance Scenarios**:

1. **Given** an unlocked app with at least one account, **When** the person opens "Add transaction", **Then** they see only: type (expense/income), amount, account, category and date, with the amount field focused, and a collapsed "More details" section.
2. **Given** the add form is open, **When** the person expands "More details", **Then** they see payee, tags, note, attachment, place, status, refund (income only) and pin, grouped and labelled, and the form remembers on this device that it was expanded.
3. **Given** the person saved a transaction on account A with category C yesterday, **When** they open the add form, **Then** the account defaults to A, the date defaults to now, and the category list shows recently used categories first.
4. **Given** the person has entered values, **When** they close the form with unsaved changes, **Then** they are asked once whether to discard; with no changes the form closes silently.
5. **Given** the person is on a phone-sized viewport, **When** they use the amount field, **Then** a numeric keyboard appears, the amount is shown formatted for their currency as they type, and the Save action stays visible without scrolling.
6. **Given** a rate is required for a foreign-currency amount, **When** the person saves, **Then** the rate prompt appears inline in the same dialog and, after entry, the save completes without losing the other entered values.

---

### User Story 2 - Find my way around a calm, well-organised app (Priority: P1)

A person opens the app and immediately understands where they are and where things live. A short list of primary places is always visible. Related screens are grouped under them. The current Fold, sync state and lock control sit in a consistent, quiet spot.

**Why this priority**: Wayfinding affects every session and every other screen. A calm shell is the foundation on which every other story is built.

**Independent Test**: A new tester is asked to find five things (add an account, see this month's spending, set a budget, change the appearance, add a device). At least 90% locate each in at most 2 navigation steps without help.

**Acceptance Scenarios**:

1. **Given** an unlocked app on a desktop-sized viewport, **When** it loads, **Then** a persistent side navigation shows exactly the 5 primary entries, the current one is visibly marked, and secondary items are not shown as top-level entries.
2. **Given** a phone-sized viewport, **When** the app loads, **Then** primary navigation is reachable from a compact control that does not consume vertical space, and the current section title is shown in the page header.
3. **Given** the person is on any screen, **When** they look at the shell, **Then** the current Fold name (with a way to switch Folds when more than one exists), the sync status and the lock action are present in one consistent location, separate from the navigation entries.
4. **Given** the person uses only a keyboard, **When** they tab through the shell, **Then** a "skip to content" link is first, focus order follows visual order, and the current section is announced.
5. **Given** the primary sections, **When** the person opens one that contains related screens (for example Plan: budgets, goals, schedules), **Then** the related screens are reachable as tabs or a segmented control inside it, not as separate top-level entries.
6. **Given** any previously valid address (bookmark) for an old screen, **When** it is opened, **Then** the person lands on the corresponding new place, not an error page.

---

### User Story 3 - See how I'm doing at a glance (Priority: P1)

On the Overview, the person sees the most important figures for the chosen period, large and obvious: money in, money out, what is left, and the total balance. A single period control sits above them. Deeper analysis (by category, by tag, trend, balance over time) follows as clearly separated sections that can be collapsed, and every number can be explored.

**Why this priority**: The overview is the landing page. If it communicates the key answer ("am I spending more than I earn this month?") instantly, people return daily.

**Independent Test**: With a month of sample data, a tester states, within 5 seconds of the page loading, this month's spending and whether income exceeded it.

**Acceptance Scenarios**:

1. **Given** an unlocked app with transactions, **When** the Overview loads, **Then** the first screenful shows a period control and four headline figures (income, expenses, net for the period, and total balance), with sign and colour never being the only cue for gain or loss.
2. **Given** the Overview, **When** the person changes the period (this/last month, this/last year, last N days, all time, custom range), **Then** all figures update and the chosen period is remembered on this device.
3. **Given** the Overview, **When** the person wants less common options (include/exclude adjustments, include/exclude transfers), **Then** these are in an "Options" popover, not permanently visible, and the Overview states in plain words when a non-default option is active.
4. **Given** the by-category breakdown, **When** the person activates a category row, **Then** they are taken to the transaction list pre-filtered to that category and period.
5. **Given** the Overview's secondary sections (by category, by tag, monthly trend, balance over time), **When** the person collapses or expands a section, **Then** its state is remembered on this device, and collapsed sections still show their title and one-line summary.
6. **Given** a foreign-currency amount lacks an exchange rate, **When** the Overview loads, **Then** one concise notice explains what is missing with an action to resolve it, instead of a form embedded in the page.
7. **Given** an empty fold, **When** the Overview loads, **Then** it shows a guided next step instead of zeros.

---

### User Story 4 - Find and review past transactions without clutter (Priority: P2)

The transaction list is grouped by day with a running day total, with a prominent search field. All other filters live behind a single "Filters" control. Active filters appear as removable chips. Row actions are in a per-row menu, and tapping a row opens it for editing.

**Why this priority**: Reviewing and correcting entries is the second most frequent activity. A clean list makes it fast, and the filter panel removes the permanent clutter.

**Independent Test**: With 200 transactions, a tester finds "last Tuesday's pharmacy purchase over 20" by search and one filter in under 30 seconds, then deletes it with confirmation.

**Acceptance Scenarios**:

1. **Given** the list, **When** it loads, **Then** transactions are grouped under day headings (Today, Yesterday, then dates) and each heading shows that day's net total.
2. **Given** the list header, **When** the person types in the search box, **Then** results narrow as they type, and the result count is announced to assistive technology.
3. **Given** the list, **When** the person opens "Filters", **Then** account, category, status, date range and amount range are available in a panel; applying them closes the panel and shows each active filter as a chip with a remove control, plus "Clear all".
4. **Given** a transaction row, **When** the person activates the row, **Then** the edit dialog opens; **When** they open the row menu, **Then** Edit, Pin/Unpin and Delete are offered, and Delete asks for confirmation naming the transaction.
5. **Given** a pending, pinned, refund or attachment-bearing transaction, **When** shown in the list, **Then** it carries a small, labelled badge or icon (not colour alone).
6. **Given** a very long list, **When** the person scrolls, **Then** it stays responsive (see the success criteria), and scroll position is preserved after editing a row.
7. **Given** no transactions match, **When** filters are active, **Then** the empty state says so and offers "Clear filters".

---

### User Story 5 - One consistent, attractive look everywhere (Priority: P2)

Every screen, dialog, form, table, badge, menu and message looks and behaves like part of the same product, using the Catalyst component set: consistent spacing, typography, colour, rounded surfaces, focus rings and motion, in light and dark appearance, following the person's system choice with a manual override.

**Why this priority**: The quality of the visual design shapes trust, which is essential for a product that holds financial data. Consistency also makes every other story cheaper to build and maintain.

**Independent Test**: A design review compares every route, in both appearances, at three viewport widths, against the component inventory. No screen uses a control that is not from the shared set, and automated accessibility checks report no violations.

**Acceptance Scenarios**:

1. **Given** any screen, **When** inspected, **Then** its buttons, inputs, selects, checkboxes, radios, switches, dialogs, menus, tables, badges, alerts, avatars and pagination are the shared components, with no per-screen restyling of the basics.
2. **Given** the system appearance is dark, **When** the app loads, **Then** it renders in a dark theme with no flash of light content; **When** the person picks Light, Dark or System in settings, **Then** the choice applies instantly and persists on this device.
3. **Given** a person who prefers reduced motion, **When** they use the app, **Then** transitions and animations are minimal or absent.
4. **Given** a forced-colours/high-contrast mode, **When** the app is used, **Then** all controls, focus indicators and state cues remain visible.
5. **Given** amounts, **When** shown anywhere, **Then** they use one consistent, tabular, right-aligned number style, with a minus sign and the currency, and gain/loss is conveyed by more than colour.
6. **Given** a destructive action, **When** the person triggers it, **Then** it uses a consistent confirmation dialog pattern with a clearly labelled destructive button and a safe default focus.

---

### User Story 6 - Plan in one place (Priority: P2)

Budgets, goals and recurring schedules are grouped under a single "Plan" section with a segmented switch. Each item is a card with a clear progress cue; creating or editing happens in a dialog or side panel that shows only the essential fields first.

**Why this priority**: These three features share one purpose (looking ahead), and grouping them removes three entries from the top level while making each easier to understand.

**Independent Test**: A tester creates a monthly budget, a savings goal and a weekly recurring expense using only the Plan section, each in at most 3 steps beyond entering values.

**Acceptance Scenarios**:

1. **Given** the Plan section, **When** opened, **Then** Budgets, Goals and Schedules are available as sibling views, and the last-used view is remembered.
2. **Given** budgets, **When** listed, **Then** each shows its name, spent vs limit for the current period, remaining amount and a progress indicator whose state (on track / near limit / over) is conveyed in text as well as colour.
3. **Given** goals, **When** listed, **Then** each shows its target, saved amount, remaining, deadline (if any) and status (in progress / reached / overdue).
4. **Given** schedules, **When** listed, **Then** each shows what repeats, how often, the next occurrence, and a pending-confirmation indicator where applicable; the upcoming occurrences are viewable without leaving the list.
5. **Given** a create/edit form in Plan, **When** opened, **Then** only essential fields appear first and advanced options (for example rollover rules, reminders, end dates) are grouped under "More options".

---

### User Story 7 - Settings that are easy to scan, with advanced items tucked away (Priority: P2)

Settings is a grouped list (Profile and security, Appearance, Categories, Sync and devices, Data and storage, Folds and sharing, Advanced). Choosing a group opens its own page or panel. Risky or technical settings live under Advanced. One-time secrets and recovery flows keep their existing protective behaviour but gain a clearer, calmer presentation.

**Why this priority**: Settings currently mix everyday choices with technical and dangerous ones. Grouping reduces mistakes and anxiety.

**Independent Test**: A tester finds "change appearance to dark", "see connected devices" and "export my data" each in at most 2 steps from the Settings entry.

**Acceptance Scenarios**:

1. **Given** the Settings entry, **When** opened, **Then** it lists no more than 7 groups, each with a one-line description, and shows no form controls directly.
2. **Given** the "Advanced" group, **When** opened, **Then** it contains server address, storage details and other technical items, each with a short explanation of when to change it.
3. **Given** a flow that displays a one-time secret (for example, the Secret Key or a recovery code), **When** shown, **Then** it appears in a dedicated, uncluttered view with copy and download actions, a warning that it will not be shown again, and requires explicit acknowledgement before continuing.
4. **Given** the Appearance group, **When** opened, **Then** the person can choose theme (Light/Dark/System) and which optional fields appear in the add-transaction form (see FR-021), with a live preview where practical.

---

### User Story 8 - A friendly first run and helpful empty states (Priority: P3)

A new person is guided from nothing to a useful first state (create account → first Fold → first account → first transaction) with a short, skippable checklist. Every list that can be empty explains itself in one sentence and offers the obvious next action.

**Why this priority**: First impressions decide retention, but it matters less than the daily-use stories above.

**Independent Test**: A new tester completes sign-up and records a first transaction in under 5 minutes without outside help.

**Acceptance Scenarios**:

1. **Given** a new Fold with no accounts, **When** the Overview or Transactions opens, **Then** a single prominent call to action offers "Create your first account" and, once done, "Add your first transaction".
2. **Given** an empty list anywhere (accounts, categories, budgets, goals, schedules, transactions, devices), **When** viewed, **Then** it shows an icon, one sentence explaining the purpose, and the primary action to fill it.
3. **Given** the first-run checklist, **When** the person dismisses it, **Then** it does not return, and it can be reopened from Help.
4. **Given** a feature a person has not used (for example Folds sharing), **When** they first open it, **Then** a one-time dismissible inline hint explains it in at most two sentences.

---

### User Story 9 - Manage lists with confidence (Priority: P3)

Accounts, categories, payees/tags, Folds and devices are shown as clean lists or cards. Creating and editing happen in a dialog or side panel with minimal fields. Archive, delete and other risky actions are in a row menu with clear consequences stated in the confirmation.

**Why this priority**: These are less frequent management tasks, but they are where the current interface feels most like raw forms.

**Independent Test**: A tester creates an account in a new currency, a category with one subcategory, and archives an account, each without leaving the list.

**Acceptance Scenarios**:

1. **Given** the Accounts list, **When** shown, **Then** accounts appear grouped by type with name, currency and current balance, a clear archived state (hidden by default, revealed by a toggle), and a single "Add account" action.
2. **Given** an account dialog, **When** opened, **Then** name, currency, type and opening balance come first, and the remainder sits under "More options".
3. **Given** the Categories group in Settings, **When** opened, **Then** expense and income are separate tabs, parents expand to show subcategories, and archive/delete live in the row menu.
4. **Given** any delete or archive, **When** confirmed, **Then** the dialog states exactly what will happen to related transactions (for example "12 transactions will become uncategorised").

---

### Edge Cases

- **Narrow and wide screens**: 320 px wide (the smallest supported), 768 px (tablet), and 1920 px+ (wide desktop). There is no horizontal page scrolling at 320 px apart from wide data tables inside their own scroll area, and content does not stretch into unreadably long lines on wide screens.
- **Large text and zoom**: at 200% browser zoom and at the largest system text size, nothing is clipped or overlaps, and primary actions remain reachable.
- **Right-to-left languages**: layout, icons with direction, and numeric alignment mirror correctly.
- **Very long names** (accounts, categories, payees) truncate with a visible full-text affordance and never break layout.
- **Many items**: 100 accounts or 10,000 transactions remain usable, with search, grouping and bounded rendering.
- **Offline or syncing**: the shell shows a neutral, non-alarming status; local actions are never blocked by a visual state, and errors are explained in plain language with a next step.
- **Locked or covered app**: the privacy cover and unlock screens use the same visual language, show no financial content in the app switcher or screenshots of the cover, and restore the exact previous view after unlock.
- **Unsaved changes** in any dialog: closing, navigating away or locking prompts exactly once, never silently discards, and never traps the person.
- **Hidden fields that hold values**: if an optional field is hidden by preference but already has a value (editing an old transaction), it is shown anyway so data is never invisible.
- **Preference storage unavailable** (private mode, cleared data): the interface falls back to sensible defaults and keeps working.
- **Old bookmarks and deep links**: removed or merged routes redirect to their new homes.
- **Missing exchange rate / pending / void states** remain explained and actionable in the new layout.
- **Loading**: skeleton or placeholder states avoid layout jumps, and content that takes over 400 ms shows a progress cue.
- **Keyboard and screen-reader use** reach every function, including menus, dialogs, tabs, popovers and the date/amount inputs.
- **Printing/exporting** is unchanged and not part of this redesign.

## Requirements *(mandatory)*

### Reference Patterns Adopted and Adapted

The table maps interaction ideas from the reference study to requirements here. The mapping is inspirational, not a feature list.

| Idea in reference study | Where used here |
|---|---|
| Few top-level sections (accounts, transactions, plan, report, settings) | FR-001 to FR-006 |
| Add-transaction button always reachable | FR-007 |
| Period selector + a small set of headline tiles above the list | FR-014 to FR-018 |
| Transaction list grouped by day with a daily summary | FR-024 |
| Fields of the editor can be shown or hidden; defaults for new entries | FR-020 to FR-022 |
| Fast, forgiving amount entry | FR-019 |
| Filters behind one control, with an "applied" indicator | FR-025 |
| Options in a menu rather than on the page | FR-018 |
| Report rows drill down to the transactions behind them | FR-016 |
| Plan section combining goals and budgets with progress | FR-030, FR-031 |
| Grouped settings root, advanced items separate | FR-032 to FR-035 |
| First-run guidance and in-context tips | FR-036 to FR-038 |
| Edit dialogs with a dirty check | FR-011 |
| Theme choice (light/dark/system) | FR-041 |

### Functional Requirements

**Information architecture and shell**

- **FR-001**: The system MUST present exactly **5 primary sections** in the main navigation: Overview, Transactions, Accounts, Plan and Settings. Fold switching is not a section; it lives in the shell (FR-005). Screens not in this list (Transfers, Budgets, Goals, Schedules, Categories, Data, Devices) MUST be reachable from inside a primary section, not as separate top-level entries.
- **FR-002**: The mapping of every existing screen to its new home MUST be: Overview ← Dashboard; Transactions ← Transactions and Transfers (transfers are created from the same add flow and listed in the same list with a distinct label); Accounts ← Accounts only; Plan ← Budgets, Goals, Schedules; Settings ← Settings, Categories (together with the tags and payees that are managed alongside them), Data (import/export/backup), Devices, and Folds management and sharing (the Fold switcher itself stays in the shell). No existing function may become unreachable.
- **FR-003**: On wide viewports the system MUST show a persistent side navigation; on narrow viewports it MUST show a compact navigation (menu control and/or bottom bar) that does not take more than one row of vertical space.
- **FR-004**: The current section MUST be visibly and programmatically marked as current in every navigation form.
- **FR-005**: The shell MUST show, in one consistent place separate from the navigation entries: the current Fold name (always) with a switcher (offered only when the person has more than one Fold or shared Folds), the sync status, and the lock action.
- **FR-006**: Every previous screen address MUST redirect to the screen's new location (including in-page state such as a pre-selected account where the old address supplied it).

**Global actions and forms**

- **FR-007**: A primary "Add transaction" action MUST be reachable from every screen of the unlocked app within one interaction, and MUST open the add flow without leaving the current screen: as a slide-up sheet on phone-sized viewports (with the Save action always visible above the on-screen keyboard) and as a centred dialog on larger viewports.
- **FR-008**: Creating and editing any entity (transaction, transfer, account, category, budget, goal, schedule, payee/tag, member invitation) MUST happen in a dialog, panel or dedicated page that uses the same layout: title, essential fields, an optional collapsed "More details/options" group, and a footer with one primary and one secondary action.
- **FR-009**: Each form MUST classify its fields as **essential** (always visible), **optional** (inside the collapsed group) or **technical** (only under Advanced settings or in an explicitly expanded "Advanced" group). The default view of each form MUST show no more than **6 fields**, not counting the type switch (expense / income / transfer) that sits in the header of forms that have one.
- **FR-010**: Field labels, helper text and errors MUST be shown consistently: label above the field, helper text below, error text replacing helper text, with the invalid field programmatically linked to its message. Errors MUST explain how to fix the problem in plain language.
- **FR-011**: Closing a form with unsaved changes MUST prompt once for confirmation; closing a form with no changes MUST NOT prompt. The primary action MUST be disabled or clearly indicate a busy state while saving, and MUST prevent double submission.
- **FR-012**: Destructive and irreversible actions MUST use a confirmation dialog that names the item, states the consequence, labels the button with the action (for example "Delete transaction"), and focuses the safe option by default.
- **FR-013**: Success MUST be acknowledged unobtrusively (for example a brief status message) without blocking further input. No new undo toast is added. The existing "Recently deleted" list and its Restore action (spec 001) MUST remain available from the Transactions section.

**Overview**

- **FR-014**: The Overview MUST show, above all other content, a single period control and four headline figures: income, expenses, net for the period, and total balance in the Fold's base currency.
- **FR-015**: The period control MUST offer this month, last month, this year, last year, last 30/90 days, all time and a custom range, remember the last choice per device, and always state the resolved dates.
- **FR-016**: Each breakdown row (by category, by tag, by account) MUST open the transaction list filtered to that item and the current period.
- **FR-017**: Secondary Overview sections (by category, by tag, monthly trend, balance over time, account balances) MUST each be a titled section that the person can collapse and expand, with state remembered per device and a one-line summary shown when collapsed.
- **FR-018**: Rare options (include/exclude adjustments, include/exclude transfers) MUST live in an "Options" menu and MUST be disclosed in text near the headline figures when they differ from the defaults.

**Transaction entry**

- **FR-019**: The amount field MUST accept the person's locale formatting, show the currency, open a numeric keyboard on touch devices, and accept a single number only (no expressions), parsed exactly with no floating-point rounding.
- **FR-020**: The add-transaction form MUST default to showing: type, amount, account, category and date. All other fields (payee, tags, place, note, attachment, status, refund, pin) MUST be in a collapsed "More details" group, and place entry MUST offer "Use my location" and a name without showing raw coordinates unless expanded under an advanced place view.
- **FR-021**: The person MUST be able to choose, per device, which optional fields are shown by default in the add form, and to expand "More details" in one interaction. Fields that already contain a value MUST always be shown when editing, regardless of this preference. Preferences MUST be stored only on the device and MUST NOT be synchronised or included in user data exports.
- **FR-022**: New transactions MUST default to the most recently used account and the current date and time, and the category choices MUST list recently used and frequently used categories first, then all categories grouped by parent.
- **FR-023**: Transfers between accounts MUST be creatable from the same add flow by switching the type, reusing the same layout, and requiring only the second account (and, where currencies differ, the received amount or rate) as extra essential fields.

**Transaction list and search**

- **FR-024**: The list MUST group transactions by day with sticky day headings and a day net total, and MUST show per row: the category's initial tinted with its colour, payee or note as title, category and account as subtitle, amount (with currency), and small labelled badges for pending, void, pinned, refund, transfer and attachment states.
- **FR-025**: The list MUST provide a persistent search field and a single "Filters" control that opens a panel with account, category, status, date range and amount range. Active filters MUST be shown as removable chips with a "Clear all" action, and the chip count MUST be shown on the Filters control.
- **FR-026**: Row actions MUST be in a per-row menu (edit, pin/unpin, delete), the row itself MUST open the editor, and the whole row MUST be operable by keyboard.
- **FR-027**: The list MUST announce result counts to assistive technology, keep scroll position after edits and remain responsive with at least 10,000 transactions.

**Accounts and categories**

- **FR-028**: Accounts MUST be displayed as a list or cards grouped by type with name, currency and current balance, a toggle revealing archived accounts, and per-account actions in a menu (add transaction, adjust balance, edit, archive).
- **FR-029**: Categories, tags and payees MUST be managed in the Settings → Categories group (FR-032), with tabs for expense categories, income categories, tags and payees; categories use separate expense and income views, expandable parent/child rows, and archive/delete in a row menu whose confirmation states how many transactions are affected.

**Plan**

- **FR-030**: The Plan section MUST host Budgets, Goals and Schedules as sibling views with a segmented control, remember the last view, and show a progress or status indicator for every item that includes a text description of the state, not colour alone.
- **FR-031**: Budget, goal and schedule forms MUST follow FR-009: essential fields first, advanced options (for example rollover, reminders, end date, weekday rules) grouped under "More options".

**Settings**

- **FR-032**: The Settings section MUST present no more than **7 groups** (Profile and security, Appearance, Categories, Sync and devices, Data and storage, Folds and sharing, Advanced), each with a one-line description, and each group MUST open its own page or panel.
- **FR-033**: Technical settings (server address, storage diagnostics) MUST be under Advanced, each with a sentence explaining when to change it.
- **FR-034**: Flows that reveal a one-time secret MUST present it in an uncluttered dedicated view with copy and download actions, a clear "shown once" warning and an explicit acknowledgement step, preserving all protections defined in spec 001 (nothing logged, nothing persisted in the clear).
- **FR-035**: The Appearance group MUST include theme (Light/Dark/System) and the optional-field preferences from FR-021.

**First run and empty states**

- **FR-036**: A new person MUST be guided with a short, skippable, dismissible checklist (create account, create first Fold, add an account, add a transaction) that does not return after dismissal and can be reopened from Help.
- **FR-037**: Every list that can be empty MUST show an illustration or icon, a one-sentence explanation and the primary action.
- **FR-038**: A first-time dismissible hint MAY be shown for less common features and MUST NOT block interaction or reappear after dismissal.

**Visual system**

- **FR-039**: All screens, including authentication, recovery, unlock, privacy cover and error screens, MUST be built from one shared set of components derived from the **Catalyst UI kit**: button, input, textarea, select, listbox/combobox, checkbox, radio, switch, field/label/description/error, dialog, alert, dropdown menu, badge, avatar, table, pagination, description list, divider, heading, text, link, navbar, sidebar and stacked/sidebar/auth layouts.
- **FR-040**: The visual language MUST define and reuse a single set of design tokens for colour, typography scale, spacing, radius, elevation and motion, with **emerald** as the accent colour and **Ubuntu** as the typeface (Regular, Medium and Bold are sufficient; Italic only if the design uses it), bundled with the app and never loaded from a third party. Accent shades used for text, buttons and focus indicators MUST be chosen so that every pairing meets WCAG 2.2 AA contrast in Light and Dark appearance (a lighter emerald shade is not acceptable behind white text if it fails), and MUST NOT introduce per-screen one-off styles for the basics covered by the shared components.
- **FR-041**: The system MUST support Light, Dark and System appearance, default to System, apply the choice without a flash of the wrong theme, persist it on the device, and keep every colour pair at WCAG 2.2 AA contrast.
- **FR-042**: Monetary amounts MUST use a consistent number style (tabular figures, right-aligned in tables/lists, explicit minus sign, currency shown), and gain/loss/warning states MUST always carry a non-colour cue (sign, icon or text).
- **FR-043**: Tables MUST be responsive: on narrow screens they MUST collapse to stacked rows or scroll within their own container, never forcing horizontal page scroll.
- **FR-044**: Iconography MUST use a single coherent icon set; icons that convey meaning MUST have text alternatives, and decorative icons MUST be hidden from assistive technology.

**Accessibility, localisation and quality**

- **FR-045**: Every screen MUST meet WCAG 2.2 AA: full keyboard operability, visible focus, logical focus order, focus management for dialogs/menus (trap and restore), labelled controls, announced dynamic changes, touch targets of at least 44×44 CSS px on touch viewports, and support for reduced motion and forced colours.
- **FR-046**: All user-visible strings added or changed by this redesign MUST go through the existing localisation mechanism, support right-to-left layout, and tolerate text expansion of 40% without clipping.
- **FR-047**: Layouts MUST work from 320 px to 1920 px wide with no horizontal page scrolling at 320 px, and MUST be comfortable at 200% zoom.

**Constraints inherited from the existing product**

- **FR-048**: The redesign MUST NOT change domain behaviour, stored data, synchronisation, cryptography or protocol. All behaviour defined in spec 001 MUST remain available with identical outcomes.
- **FR-049**: The redesign MUST NOT introduce third-party scripts, analytics, remotely loaded fonts/icons/styles or any request to a third party; all visual assets MUST be bundled and served with the app, and the strict content-security policy and integrity controls MUST continue to pass.
- **FR-050**: The redesign MUST keep every local function working fully offline, and MUST NOT block any local interaction on network state.
- **FR-051**: UI preferences introduced here (appearance, optional-field visibility, collapsed sections, last-used period and Plan view) MUST be stored per device only, MUST contain no financial content, and MUST fail safe to defaults if storage is unavailable.
- **FR-052**: The initial download size and the interaction responsiveness of the app MUST stay within the existing performance budgets, with any increase from the new component set justified and bounded (see SC-010).
- **FR-053**: The existing automated end-to-end journeys MUST be updated to the new interface and continue to cover each P1 and P2 story of spec 001 with equivalent assertions.
- **FR-054**: The new interface MUST replace the previous one entirely when it ships. No legacy layout, feature flag or "classic" switch is retained, and no code path for the old screens remains.

### Key Entities *(include if feature involves data)*

- **Primary Section**: One of the top-level places in the navigation (Overview, Transactions, Accounts, Plan, Settings). Has a name, an icon, the set of screens it contains, and a current/not-current state.
- **Interface Preference**: A per-device setting that affects only presentation: theme, which optional form fields are shown by default, which Overview sections are collapsed, the last-used Overview period, and the last-used Plan view. Not synchronised, not exported, no financial content.
- **Field Class**: A designation of each form field as essential, optional or technical. It determines default visibility and is the same everywhere a field appears.
- **Active Filter**: A user-chosen constraint on the transaction list (text, account, category, status, date range, amount range). Shown as a chip, individually removable, collectively clearable.
- **Headline Figure**: One of the four numbers at the top of the Overview, with its label, value, sign cue and period.
- **Empty State**: The explanatory content shown for a list with no items: an icon, a sentence and a primary action.
- **Route Redirect**: A mapping from a previously valid address to the corresponding place in the new structure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can record a basic expense (amount and category) in **at most 4 interactions and under 10 seconds** from any screen of the unlocked app, on a phone-sized viewport without scrolling.
- **SC-002**: The default add-transaction view shows **5 fields or fewer** (down from about 15), and **100%** of the previous fields remain reachable within one extra interaction.
- **SC-003**: The main navigation exposes **exactly 5** entries (down from 12), and **90% of first-time testers** locate each of five named features in **2 navigation steps or fewer** without help.
- **SC-004**: On first load of the Overview, **at least 90% of testers** correctly state this month's spending and whether income exceeded it **within 5 seconds**.
- **SC-005**: The number of interactive controls simultaneously visible on each of Overview, Transactions, Settings and the add form on first load is **at least 40% lower** than the baseline recorded before the redesign.
- **SC-006**: **100% of screens** (including sign-in, sign-up, recovery, unlock and error views) use only the shared component set for basic controls, verified by a component audit with zero exceptions.
- **SC-007**: Automated accessibility checks report **zero** serious or critical violations on every screen in light and dark themes, and a manual keyboard-only pass completes every P1 and P2 story.
- **SC-008**: At 320, 768 and 1920 px widths and at 200% zoom there is **no horizontal page scroll and no clipped primary action** on any screen.
- **SC-009**: **90% of new testers** complete sign-up and record a first transaction in **under 5 minutes** without outside help.
- **SC-010**: Initial-load size and interaction responsiveness stay **within the existing budgets**, and a transaction list of 10,000 items scrolls and filters with no perceptible lag (input to visible result in **under 200 ms** at the 95th percentile on a mid-range laptop).
- **SC-011**: **Zero** functions available before the redesign become unreachable, verified by walking a checklist derived from spec 001's requirements, and **100%** of the updated end-to-end journeys pass.
- **SC-012**: In a moderated review with at least 8 participants, the mean rating for "the app feels clean and easy to use" is **at least 4 out of 5**, and fewer than **10%** report "too much on the screen".

## Assumptions

- **Scope**: The redesign covers the web application. Desktop and mobile shells from the product roadmap will reuse the same design language later and are out of scope here.
- **Audience**: People already tracking personal or household finances, mixed technical skill, using phones and laptops. Right-to-left and multiple languages are supported through the existing localisation system.
- **Design foundation**: The Catalyst UI kit (local files provided at `/Users/pogulailo/Downloads/catalyst-ui-kit`, in TypeScript) is the mandated component foundation. Its headless-interaction and class-merging helper libraries (and an icon set) will be needed as additional dependencies; the kit's animation library is deliberately not adopted, and they MUST pass the project's dependency review (pinned versions, audit, licence check, bundle-size budget) before adoption.
- **Licensing**: Catalyst is a commercial product covered by the Tailwind Plus licence. The project owner holds a valid licence permitting use in this product, and the kit's files are not redistributed in a way the licence forbids (the repository's own licensing and third-party notices will be updated accordingly).
- **Identity**: The kit's structure and components are the base, with emerald as the accent and Ubuntu as the typeface; all other tokens follow the kit's defaults. The components' structure and behaviour are not forked. There is no logo or illustration redesign in this feature.
- **Icons and fonts**: Ubuntu is distributed under the Ubuntu Font Licence, which permits bundling; the licence text will be added to the third-party notices. Any icons used are open-licensed (or included in the licensed kit). Everything is bundled locally, and nothing is fetched from third-party hosts. Ubuntu covers Latin, Cyrillic and Greek; for scripts it lacks (for example CJK, Arabic, Hebrew), text falls back to the platform's system font, which is acceptable.
- **No new capabilities**: Duplicate-transaction, amount expressions, undo of deletions, calculator history, custom report builders and similar new features are out of scope. If an action (such as Duplicate) does not exist in the product, it is simply not offered.
- **Preferences**: Interface preferences are per device, local and non-sensitive. They are not part of the encrypted user data and are not synchronised.
- **Baseline**: "Baseline" in the success criteria means the control counts and behaviours recorded from the build at the start of this feature (see Observed problems).
- **Compatibility**: Existing data, projections, event formats and routes' data semantics are unchanged. Old addresses redirect.
- **Testing**: Usability measures (SC-001, 003, 004, 009, 012) are verified by moderated sessions with a small panel of representative users, and the rest by automated and manual checks.
- **Reference app**: The study in `docs/reference/reference-app/` is read-only inspiration, with its limits stated there (unverified runtime behaviour, no assets reused).
