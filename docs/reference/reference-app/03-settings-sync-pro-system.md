# 03 — Settings, Security, Sync, PRO Gating, System Integration

Tags: **[S]** string, **[M]** metadata, **[I]** inferred/unverified. See [README](README.md).

## 1. Settings catalogue

User-configurable values found in strings, ivars and persisted-key names. "Where" refers to the screen in [01](01-navigation-and-screens.md). Storage is NSUserDefaults unless noted [M].

| Setting | Values | Where | Notes |
|---|---|---|---|
| Navigation layout | Classic / Tabs | §4.34 | `preferredAppNavigationLayoutType`; migration banner offers Tabs |
| Theme | Light / Dark / Black / Clear Black; System on/off | §4.35 | Some are PRO |
| System-dark conformance | which dark theme follows the system | §4.36 | |
| Accent color | palette index | §4.38 | `accentColorSettingsKey`; PRO palette |
| App icon | primary + alternates | §4.37 | |
| Interface scale | factor | §4.34 | `manualFontScale` |
| Amount style | income/expense format and color | §4.39 | `incomeColorSettingsKey`, `expenseColorSettingsKey` |
| Icon packs | Base / Extended / Modern / Modern Extended / Outlined | §4.40 | PRO for extended ones |
| Add-transaction button position | Left / Center / Right | §4.34 | `addButtonPosition` |
| Transaction list: daily summary | None / Sum / Income / Expenses / Day-end balance | §4.7 | `transactionListGroupDetailsType` |
| Transaction list: colored attributes | on/off | §4.7 | |
| Month separator | on/off | §4.7 | `isMonthSeparatorEnabled` |
| Dashboard options | tiles, show balance/chart | §4.9 | `DashboardOption`, `_MAIN_DASHBOARD_OPTIONS_CHANGED` |
| Report options | sort, chart, other-merge, balance, counts | §4.11 | `_REPORT_OPTIONS_CHANGED` |
| Budget amount display | Expense / Limit / Available / Expense/Limit | §4.15 | `_budgetsSumType` |
| Include scheduled transactions | on/off (per Report / Plan / Budget details) | | only offered when schedules exist |
| Transaction fields | which fields show in the editor | §4.6 | |
| Default values | per-field defaults for new transactions | §4.6 | |
| Transaction time | on/off | §4.6 | |
| Fixed decimal input | on/off | §4.30 | `isFFInputMode` |
| Transfers / Adjustments as Income and Expenses | on/off each | §4.30 | |
| Round summary amounts | on/off | §4.30 | |
| First day of month | 1–28 [I] | §4.30 | `ZFFirstMonthDay` |
| General currency | currency | §4.27 | optional global reporting currency |
| Comparison currency | currency or none | | secondary estimate display |
| Favorite currencies | set | §4.27 | |
| Passcode lock + delay | off / Immediately / After N | §4.31 | secret in Keychain [I] |
| Biometry | on/off | §4.31 | Face ID / Touch ID |
| Allow widgets access | on/off | §4.31 | |
| Daily reminder | on/off, time, weekdays, text | §4.41 | |
| Auto backup | on/off | §4.47 | |
| Sync | signed in/out, device name | §4.48–4.50 | |
| Main/Report period state | last period type/group/offset | | restored on launch |
| Subperiod type (bar chart) | per period type | §4.13 | persisted |
| Location | system permission | | |
| Startup guides / tips | seen flags | | `isStartupGuidesEnabled`, `InlineTipStorage` |

## 2. Security details

- **App lock**: passcode (digits) and/or biometry; `LAContext` with `_authBiometryReason`. Lock engages per the "Require" delay after backgrounding [M/S].
- **Privacy screen**: when the app goes to background and a lock is configured, the UI is hidden (`LockScreenViewController initWithHiddenContent`) [M].
- **Keychain**: `Keychain` (+ a `KeychainDidMigrate` migration) stores the passcode and sync credentials/tokens [M/I].
- **Widgets** respect the lock via the "Allow Widgets to Access Data" switch [S].
- **Network**: App Transport Security forbids arbitrary loads; encryption is "standard only" (`ITSAppUsesNonExemptEncryption = false`) [M]. A `Cipher` type exists in the binary [M], probably for sync payload or credential protection [I].
- **Data at rest**: local Core Data store (SQLite); no evidence of database encryption in the bundle [I].

## 3. Appearance system

- Themes + accent + icon + scale are resolved by `HWAppearance`/`HWTheme`/`HWColorPalette`; an `appearanceDidChange` notification makes every screen call `updateAppearance`.
- Numbered **palette** (0–24+ indices in the demo, plus PRO colors) used for account/category/tag/goal colors; the same index is portable between devices and in sync payloads (`color: Int16`).
- **Icons**: ~4,700 bitmap icons in six bundles (`I8I7` ≈ 981, `I8IGB` 146, `I8IGE` 2,320, `I8IGH` 24, `I8W8B` 70, `I8W8E` 1,106) referenced as `<bundle>/<name>` strings; 2x/3x assets; grouped by theme for the picker (≈ 50 groups). Titles of bundles: Basic, Extended, Modern Basic, Modern Full, Outlined.
- Dynamic Type is replaced by a manual scale; Dark/Black themes support OLED "Clear Black".

## 4. Synchronization ("Sync" service)

Components: `SyncSyncer` (engine), `SyncLoginViewController`, `SyncProfileViewController`, `SyncSessionsViewController`, `SyncItem`, `NetworkStatusService`, `Cipher`.

**Account model**: email + password profile; **sessions** = devices (name, "This Device", disconnect); OTP password reset; email/password change; profile deletion; purchases can be linked to the profile so PRO follows the user across Apple accounts [S].

**Sync model** [M/I]:
1. State flags per entity type (`accountsChanged`, `transactionsChanged`, …) are set by `dataDidChange:` notifications. A debounce timer (`sendAfterDelay`) triggers `send`.
2. `objectsForSend` selects unsynced objects (limit per batch: `objectsToSendMaxCount`) and sends; on success `markAsSyncedObjects:`.
3. `fetch` pulls server changes using a **cursor** (`cursor`, `requestCursor`), repeating until caught up; interval adapts (`updateFechInterval`); background refresh task also triggers it.
4. Deletions are tracked as a persisted queue of `sid`s (`sidsToDelete`) and sent separately (`deleteAfterDelay`, `cancelAllUnsyncedDeleteions`).
5. Conflict policy is not visible; most likely last-writer-wins on `saved` [I].
6. "Perform Full Synchronization" (`resetCursorAndFetch`) resets the cursor.
7. After the first sign-in on a device with local data the user chooses to delete the local data first or merge ([01 §4.48](01-navigation-and-screens.md)).
8. Receipt/photo handling: images are *not* synced and local image refs are cleaned (`cleanUpImagesForLocalTransactions:fetched:`).
9. Statuses surfaced in the UI: syncing indicator + last update in Settings (`updateSyncIndication`, `syncFooterText`), error strings listed in 01 §4.48.

**Endpoints present as literals** (for information only): the vendor site (site, articles, rates, sync), a vendor API host (an API/proxy host), `https://buy.itunes.apple.com/verifyReceipt` and sandbox (receipt validation), and `http://localhost:8080/sync/` (a debug sync endpoint). *Do not reuse these.*

## 5. Import / export

- **Import**: CSV only; external files opened via "Open in the reference app" (document type CSV). Details in [01 §4.42–4.44](01-navigation-and-screens.md) and [02 §5](02-data-model-and-rules.md).
- **Export**: transactions (per account/group/period/filter) and reports to CSV with configurable columns, optional header and total rows; the share sheet. PRO feature ("Transactions and Reports Export").
- **Backup file**: JSON (see 02 §6).

## 6. Free vs PRO gating

the app is freemium. The paywall carousel lists these PRO features (title → description) [S]:

| Feature | Description |
|---|---|
| Accounts and Groups / Unlimited Accounts | "Create as many accounts as you like, combine them into groups, and make transfers between them" |
| Subcategories | "Set up your income and expense structure based on your needs" |
| Tags / Tags and Counterparties | "Add tags to your expenses and income" / "Refine your income and expenses with tags, payers, and payees" |
| Interactive Bar Chart | "Analyze income and expenses on a bar chart: compare days, weeks, months, and years" |
| Budgets | "Set spending limits, create budgets for a year, month, week, or day" |
| Goals | "Set financial goals, save up money, and keep track of your progress" |
| Scheduled Transactions | "Set up recurring transactions, add reminders, plan and analyze your finances ahead" |
| Cloud Sync / Synchronization | "Use on multiple devices and with partners" / "Access data from all your devices and share it with your family" |
| Backups | "Protect yourself from data loss: enable automatic iCloud backups" |
| Report Filter | "Filter data by categories, tags, payers, and payees" |
| Transaction Search | "Find transactions by amount, currency, category, tags, or location" |
| Photos of Receipts | "Add photos of receipts and any other images directly to transactions" |
| Security | "Limit access to the app by setting up a PIN, Face ID, or Touch ID" |
| Transactions and Reports Export | "Export data and analyze it in third-party software" |
| Balance Adjustment | "Manually adjust account balances if you missed some transactions" |
| Appearance | "Thousands of icons for your categories and accounts, more customization options" |
| Additional Features / And More | Duplication of transactions, counterparties, geotags, extra account settings, CSV import, archiving |

**Free-tier limits observed**: only 1–3 accounts (A/B-tested, "Only one account is available for free"…); 1 CSV import (or N); list-length caps ("Max items allowed"); transaction history caps in some drill-downs; PRO views work in *demo mode* with sample data so users can preview before buying.
**On downgrade**: "All your data will remain on your device and will be available even without a subscription." — data is retained, PRO features lock (e.g. non-free accounts become locked, not deleted) [S].

**Products**: Weekly, Monthly, Annual auto-renewing subscriptions (with an optional free trial, introductory discount and promo campaigns with countdown) and a non-consumable **Lifetime** unlock. Upgrade paths: weekly/monthly → annual ("Switch to Annual Plan"), subscriber → lifetime, "Restore Purchases", relink purchases to a sync profile. Experiments (`ABTestPaywall*`, `ABTestOnboarding*`, `ABTestTips*`, `ABTestInlineTips*`, `PaywallXDelayManager`) vary paywall design, onboarding, tips and when the close button appears [M].
**Components**: `PurchaseManager`, `ProService`, `LifetimeUpgradeManager`, `PaywallHelper`, `ProFeatures`, `ZFProManager`, `ZFPromoService`/`ZFPromoCampaign`, `PurchasePromo`, `ProUpgradeAdviser`, `ZFSearchAdsManager` (Apple Search Ads attribution) [M].

## 7. Purchase flow (as inferred) [I]

1. The user taps a locked control (`PurchaseSource`) → the paywall opens on the relevant feature page.
2. Select plan → StoreKit purchase → receipt validated (Apple `verifyReceipt`, possibly also via the vendor server for the linked-profile case) → `proStateDidChange` notification → all screens refresh and unlock.
3. Restore purchases re-validates the receipt; with a sync profile, PRO entitlement can be attached to the profile and propagate to other devices.

## 8. Notifications and background

- **Daily reminder** (local notification, user time + weekdays + text).
- **Scheduled-transaction reminders** (local notifications; "On Time" or "N before") and a **pending-confirmation** notification handled by `handleResponseOnSystemNotification:` (tap routes to the transaction/confirmation) [S/M].
- Permission handling: if denied → "Notifications are disabled in Settings" with "Open Settings".
- **Background refresh** (BGTask `the app's refresh BGTask id`): sync/schedule generation, rates update [M/I].
- **App icon badge / tab badge**: pending confirmations count (`notificationCounterKey`, `PendingTransactionsCountDidChange`) [M/I].

## 9. Widgets, shortcuts, extensions, Catalyst

- Widgets: see [01 §5](01-navigation-and-screens.md). They share the Core Data store/rates/icons with the app (app group container) [I].
- Quick action "Add Transaction".
- **Mac Catalyst** support (strings with "Mac" suffix: "click to change", "Click the budget to see details"; `ColumnAppRouter.configureSceneForCatalyst`, `Window`, `EscapeKeyNavigationPolicy`, find interaction, focus support: `canFocusRowAtIndexPath`) [M/S].
- iPad: all orientations; iPhone: portrait only [M].

## 10. Info-tip texts (coach marks), by screen [S]

- **Main**: transactions list "TRANSACTION LIST for the current account for the selected period"; "Your recent transactions"; "Add an expense or income"; "Find additional options here"; dashboard tiles (see 01 §3).
- **Accounts**: "Accounts List — Here you can manage all your accounts…"; "Add a new account or account group"; "Edit the accounts list".
- **Plan**: "Tap the budget to see details".
- **Report**: "Choose a report type"; "Tap the amount to see details"; "ADDITIONAL FILTER"; "REPORT PARAMETERS".
- **Inline tips** in editors/lists: account edit, group edit, budget edit, goal edit, categories, counterparties, tags, scheduled transactions (texts in 01).

## 11. Localization

- 16 locales (`de, en, en-GB, es, fr, it, ja, ko, nl, pl, pt, pt-BR, ru, uk, zh-Hans, zh-Hant`), each with `Localizable.strings` (679 keys, `_`-prefixed), `Categories.<ext>` (localized default categories keeping the same sids), `DemoData.json`, `Reviews.json`, `IconBundles.strings`, `InfoPlist.strings` and `AppiraterLocalizable.strings`.
- Plurals/placeholders use `%@` and `[[name]]` tokens (rich-text substitution). Non-breaking spaces are used inside amounts and "per period" strings.
- Marketing "achievement" strings appear in the paywall (rating, installs).
- `Reviews.json` holds localized user review quotes for the paywall/onboarding [M].
- Currency names/symbols and date formats follow the locale; the CSV importer auto-detects locale formats.

## 12. Privacy manifest (`PrivacyInfo.xcprivacy`)

Declared collected data types, all "not used for tracking": Email address (linked; app functionality + personalization), Other financial info (linked; functionality), Coarse location (linked; functionality), User ID (linked), Device ID (linked), Product interaction (not linked), Performance data (not linked). The required-reason API: UserDefaults [M]. The data is collected only for sync and cloud features; local-only use needs no account [I].

## 13. Open questions (verify at runtime before specifying)

1. Exact transaction `type` codes (is "transfer" 3?) and how pair rows are typed.
2. Schedule `period` code table and weekly-day encoding.
3. Where the transaction date lives in the model (the `time`/`end` string formats).
4. The significant-transactions rule.
5. The exact free-tier numbers (accounts, imports, list limits), which are remote-configured (`RemoteParameters`, `ZFOptionsService`, `ZFRemoteFilter`) and A/B-tested.
6. Sync conflict resolution and the wire protocol.
7. The widget families per widget and the Lock Screen accessory content.
8. The Swift-only screens' control order (transaction editor, budget editor, report options, filter, paywall v3) → capture on a device or simulator.

Suggested next step for any of these: run a legitimate copy of the app on a device or simulator and capture screenshots. `rea trace-native-ui-action` can then trace a compiled UI action selector to its handler in the binary. `rea capture-native-ui-scenario` was not tried here, and whether it supports iOS windows is unverified.
