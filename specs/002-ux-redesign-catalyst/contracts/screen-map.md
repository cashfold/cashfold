# Contract: Screen Map — Reference Study → Cashfold

**Spec**: Reference Patterns table, User Stories 1–9 | **Source**: [docs/reference/reference-app](../../../docs/reference/reference-app/) (interaction ideas only; its evidence tags **[S]/[M]/[I]** apply — items tagged **[I]** are unverified and were not relied on for a hard requirement)

Legend for the **Verdict** column: **Adopt** (use the idea), **Adapt** (use it, changed to fit Cashfold's model), **Decline** (not taken, reason given).

## 1. Shell and navigation

| Reference (doc §) | Cashfold target | Verdict | What carries over / why not |
|---|---|---|---|
| Five sections: Accounts, Transactions, Plan, Report, Settings ([01 §1.3](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Overview, Transactions, Accounts, Plan, Settings | Adapt | Same count and idea. Cashfold has no separate Report; the report role is split between Overview (figures, breakdowns) and Transactions (drill-down). |
| Three layouts: Classic drawer, Tabs, Column ([01 §1.4](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | One responsive sidebar layout | Decline (two of three) | A layout choice is a settings burden; one adaptive layout is enough (R-UX-11). |
| Floating "add" button, position configurable ([01 §1.4](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Persistent Add action (header/top bar) | Adapt | Always reachable (FR-007). Position setting declined. |
| Bottom banner area for demo data, upsell, rating prompts ([01 §1.2](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Banner slot with priority (existing notices) | Adapt | Only existing notices (removed, storage full, kit reminder, storage). No upsell or rating prompts (privacy, no growth hacks). |
| Quick action "Add Transaction" on app icon | `?new=` deep link (PWA shortcut optional) | Adapt | `manifest` shortcut can reuse `?new=expense`; optional task. |

## 2. Transactions

| Reference (doc §) | Cashfold target | Verdict | Notes |
|---|---|---|---|
| Main screen: period cell → 4 dashboard tiles → list ([01 §3](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Overview has the tiles; Transactions has the list | Adapt | Keeps the two jobs on two pages, avoiding the reference's long single table. |
| Day-grouped list with daily summary options ([01 §3, §4.7](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Day groups with a net total | Adopt (one summary kind) | Single summary type (net). The choice of Sum/Income/Expenses/Day-end balance is declined (configuration weight). |
| Row context menu: edit, duplicate, pin, delete | Row menu: edit, pin/unpin, delete | Adapt | No duplicate (not in product). |
| Pending-confirmation rows with Confirm ([01 §3](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Existing schedule "inbox" (confirm/skip) | Adapt | Shown as a banner/section at the top of Transactions and as a badge count in the sidebar entry. |
| Filter behind one button, "Filter applied" ([01 §4.14](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Filters panel + chips | Adopt | |
| Search screen ([01 §4.28](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Persistent search field in the list header | Adapt | Not a separate screen. |
| "Significant" mode, pinned mode, scheduled mode [I] | None | Decline | Rules unknown / not in product. Pinned stays as a flag and filter chip option if the query supports it (otherwise out of scope). |
| Pull-to-action [I] | None | Decline | |

## 3. Transaction editor

| Reference (doc §) | Cashfold target | Verdict | Notes |
|---|---|---|---|
| Fields can be hidden; defaults for new entries ([01 §4.5–4.6](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Field registry + per-device prefs + "More details" | Adapt | Per-field toggles in Settings → Appearance; filled fields always shown. |
| Dedicated keypad with calculator [M] | Native numeric keyboard | Decline | Out of scope after clarification Q1. |
| Type switch Expense / Income / Transfer ([01 §4.5](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Same sheet, type switch | Adopt | Transfer reuses the sheet (FR-023). |
| Place with Detect/Update/Clear, "Unknown place" | "Use my location" + name; coordinates under disclosure | Adapt | Raw coordinates are a technical field. |
| Photo add/delete | Existing attachment field | Adopt (restyled) | |
| Dirty check on close ([01 §1.5](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Same | Adopt | FR-011. |
| Refund, adjustment, pin flags | Existing refund (income), adjustment (account action), pin | Adopt | |

## 4. Accounts

| Reference (doc §) | Cashfold target | Verdict | Notes |
|---|---|---|---|
| Accounts list with groups, current balance, archive, edit mode with reorder ([01 §4.1–4.2](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Accounts grouped by type; row menu; archived toggle; reorder via row menu (Move up/down) | Adapt | Cashfold's existing up/down buttons move into the menu. Drag-and-drop reorder is declined (a11y and cost). |
| Account groups as first-class | Existing groups (if present) shown as sections | Adopt | |
| Adjust balance | Existing, via row menu | Adopt | |
| Per-account "show balance" switch | None | Decline | Balance is always shown. |
| Free-tier account limit | None | Decline | No paid tier. |

## 5. Overview / reports

| Reference (doc §) | Cashfold target | Verdict | Notes |
|---|---|---|---|
| Report type switch Expenses/Income, breakdown by category/tag/counterparty/place ([01 §4.10](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Overview sections: by category, by tag | Adapt | Only what the product already computes. A type switch can be added if the query supports it; otherwise out of scope. |
| Pie and bar chart; tap slice to drill down | Existing accessible SVG chart + table; rows drill down | Adapt | Drill-down is the adopted part. Chart type switch declined. |
| Combine small values into "Other" | None | Decline | |
| Balance on date cell | "Total balance" tile and "Balance over time" section | Adapt | |
| Include scheduled toggle, transfers/adjustments as income/expense ([01 §4.10, §4.30](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Options dropdown with explanatory note | Adopt | FR-018. |

## 6. Plan

| Reference (doc §) | Cashfold target | Verdict | Notes |
|---|---|---|---|
| Plan screen: goals + budgets with sticky section headers ([01 §4.15](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | `/plan/` tabs: Budgets, Goals, Schedules | Adapt | Tabs instead of one long scroll; schedules join the section (reference keeps them in Settings). |
| Budget cards with Expense/Limit/Available and progress | `PlanCard` with progress + text status | Adopt | |
| Goal card: saved, remaining, "by date", Achieved/Overdue | Same | Adopt | |
| Budget details with period selector and the contributing transactions | Link from a budget card to the Transactions list filtered to the budget's scope and period | Adapt | No new screen; uses list filters. If a budget's scope cannot be expressed as list filters the link is omitted. |
| Budget editor modes (which categories/tags) | Existing scope pickers; essential vs optional split | Adapt | |
| Scheduled transactions: repeat, reminder, "wait for manual confirmation" ([01 §4.20–4.21](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Existing schedules, restyled; inbox/upcoming/active/finished/projected as sections | Adapt | Sections collapse; inbox first. |

## 7. Settings

| Reference (doc §) | Cashfold target | Verdict | Notes |
|---|---|---|---|
| Settings root: ordered rows to sub-screens ([01 §4.29](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | `/settings/` list of seven groups | Adopt | |
| Advanced Settings screen (rounding, first day of month, transfers as income/expense) ([01 §4.30](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Settings → Advanced | Adapt | Only options that exist in Cashfold (service address, storage diagnostics, notification amounts). No new options are added. |
| Security: passcode, biometry, delay ([01 §4.31](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Profile and security (auto-lock, hidden grace, quick unlock) | Adapt | Existing mechanisms. |
| Appearance: theme, accent, icon, scale, navigation layout ([01 §4.34–4.38](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Appearance: theme (Light/Dark/System), optional add-form fields | Adapt | Accent colour fixed (emerald). Icon packs, app icons, scale, layout choice declined. |
| Categories, tags, counterparties as managed lists with search and add-by-typing ([01 §4.22–4.26](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Settings → Categories (tabs: Expense, Income, Tags, Payees) | Adapt | Merge/archive/reorder/delete in the row menu. |
| Backups, import/export, delete data ([01 §4.42–4.47, 4.51](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Settings → Data and storage | Adapt | Restyle only; the flows are unchanged. |
| Sync login/profile/sessions ([01 §4.48–4.50](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Settings → Sync and devices (+ `/add/`) | Adapt | Cashfold's model differs (device keys, no vendor account). Only the list-of-devices presentation idea carries over. |

## 8. First run, empty states, help

| Reference (doc §) | Cashfold target | Verdict | Notes |
|---|---|---|---|
| Welcome pager, then paywall ([01 §4.53, 4.55](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | Sign-up flow + a skippable in-app checklist | Adapt | No paywall. No pager. Checklist: create Fold, add an account, add a transaction. |
| Empty-state texts per list ([01 §3, §4.1](../../../docs/reference/reference-app/01-navigation-and-screens.md)) | `EmptyState` on every list | Adopt | |
| Inline tips / coach marks ([01 §2, 03 §10](../../../docs/reference/reference-app/03-settings-sync-pro-system.md)) | One-time dismissible hints (≤ 2 sentences) | Adapt | No coach-mark sequences. |
| Rating prompt, feedback form, promo banners | None | Decline | No third-party calls or growth prompts (FR-049). |

## 9. Cashfold-only screens (no reference counterpart)

| Screen | Treatment |
|---|---|
| Sign-up, Secret Key, unlock, recovery, add device | Auth layout with the shared components. One-time secrets get the dedicated view (FR-034). |
| Folds and sharing (members, invitations, fingerprints, QR) | Settings → Folds and sharing; cards for Folds and members; the fingerprint and QR views keep their safety text. |
| Privacy cover, storage notice, kit reminder, support gate, error boundary | Restyled with the shared components; behaviour unchanged. |
| Rate manager (custom FX rates) | Panel reachable from the add sheet and Settings → Advanced. |
