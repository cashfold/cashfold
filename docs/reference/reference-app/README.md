# Reference App (iOS) — Reverse-Engineered Reference

Reference material derived from a static analysis of the iOS expense-tracker app (the "reference app"; v1.43.3 build 43.3.1, category *Finance*), for use as input to cashfold feature specs.

| Doc | Contents |
|---|---|
| [README.md](README.md) (this file) | Scope, method, evidence levels, provenance caveat, feature map |
| [01-navigation-and-screens.md](01-navigation-and-screens.md) | App shell, navigation layouts, and a per-screen spec for every screen |
| [02-data-model-and-rules.md](02-data-model-and-rules.md) | Entities, fields, enums, calculation rules, default content (categories, demo data) |
| [03-settings-sync-pro-system.md](03-settings-sync-pro-system.md) | Settings tree, security, backups, sync, import/export, PRO gating, widgets, notifications, localization |

## 1. Method

Tooling: `rea` / `rea-agents` 6.4.0 (Ghidra 12.1.4 provider; Hopper not installed), plus `plutil`, `strings`, `codesign`, and Python (`plistlib`) for plists and the compiled Core Data models.

Analyzed from the unpacked app bundle:

- `Info.plist`, `PrivacyInfo.xcprivacy`: identity, permissions, shortcuts, background modes, document types.
- `en.lproj/Localizable.strings` (679 keys): the main source of screen titles, labels, footers, empty states, errors, and tips. Other `*.lproj` folders are translations (16 locales).
- `the model bundle/the latest model version (v26)` (latest of 26 Core Data model versions): all entities and attributes.
- `en.lproj/DemoData.json`, `Categories.<ext>`, `BaseRates.json`: sample data, default category tree, and bundled FX rates.
- The main Mach-O (arm64). `rea inspect-native-dispatch-metadata` (20,000-record cap) gave 178 Objective-C classes with ivars and selectors. `strings` gave Swift type names (the binary is stripped; Swift members are not recoverable from symbols).
- `PlugIns/WidgetsExtension.appex` and `WidgetIntents.appex`.

## 2. Evidence levels (read this before using a statement as a requirement)

Each claim in the docs carries one of these tags:

- **[S] String/label**: the exact user-facing text exists in the bundle. High confidence that the text exists. It does not prove where it is shown.
- **[M] Metadata**: the class, ivar, selector, or Core Data attribute exists in the binary or model. High confidence for existence and naming. Behavior is inferred from the names.
- **[I] Inferred**: a reasoned reconstruction (e.g. layout order, flow, how a field is used) that combines [S] and [M]. **Not verified at runtime.** Treat as a hypothesis and confirm against the running app before it becomes a hard requirement.

Not done: no dynamic analysis, no runtime screenshots (`capture-native-ui-scenario` was not used because the app is iOS-only and was not run). There are no storyboards (only `LaunchScreen.nib`), so all UI is built in code. Pixel layout, spacing, fonts, and colors are **out of scope**. The visual assets (`Assets.car`, icon bundles) were inventoried but not reproduced.

Swift-implemented screens do not expose ivars or selectors in ObjC metadata. These are the transaction editor, budget editor, report options, filter, scheduled transactions, export, import entry, pie chart, onboarding, paywall (v3), and tips. Their specs rest on localization strings plus type names, so they are mostly [S]/[I].

## 3. Provenance caveat

The analyzed bundle is **not a pristine App Store build**. It carries a third-party re-signing marker file, `Frameworks/masterSideloadFix.dylib`, and an extra injected dylib (394 KB) that references the app's PRO-state classes (`ZFProManager`, `ProService`) and embeds a base64 image. Treat this as a tampered copy whose PRO gating may have been patched.

- This analysis only used the bundle's original resources and metadata.
- The injected dylib was not analyzed or documented beyond noting it exists.
- Do not reuse this binary, its resources (icons, illustrations, the 4,700+ icon bitmaps, translations, bundled FX data), or its server endpoints in cashfold. Those are the original authors' copyrighted assets and services. This reference is for **functional/behavioral specs only**: re-implement independently, with original artwork, copy, and icon sets.

## 4. Product summary

The reference app is a personal income/expense tracker with:

- Multi-currency **accounts**, **account groups**, and transfers.
- **Hierarchical categories** (2 levels), **tags** (up to 3 per transaction), **counterparties** (payer/payee), **places** (geotags), and receipt **photos**.
- **Reports**: pie and bar charts over flexible periods, with drill-down and filters.
- **Budgets** (per period, per category/tag/account), **savings goals**, and **scheduled/recurring transactions** with reminders and manual confirmation.
- **Search**, **CSV import/export**, **iCloud backups**, optional cloud **sync** (own account service, `the vendor site`), passcode/biometric lock, **home-screen widgets**, themes/icons/accent colors, and a freemium **PRO** (weekly/monthly/annual/lifetime).

Platforms: iPhone and iPad (min iOS 10 per `Info.plist`, Mach-O built for iOS 15+), Mac Catalyst code paths (`...Mac` strings, `ColumnAppRouter`), 16 localizations.

## 5. Feature map (area → where specified)

| Area | Screens ([01](01-navigation-and-screens.md)) | Data ([02](02-data-model-and-rules.md)) | System ([03](03-settings-sync-pro-system.md)) |
|---|---|---|---|
| Accounts & groups | §4.1–4.4 | §2.1, 2.2 | PRO limits §6 |
| Transactions | §3, 4.5–4.9 | §2.3 | — |
| Reports & charts | §4.10–4.14 | §3.4 | — |
| Plan: budgets & goals | §4.15–4.19 | §2.5, 2.6, 3.5 | — |
| Scheduled transactions | §4.20–4.21 | §2.7 | Notifications §8 |
| Taxonomy (categories, tags, counterparties, currencies) | §4.22–4.27 | §2.4, 4 | — |
| Search | §4.28 | — | — |
| Settings, security, appearance | §4.29–4.41 | — | §1–3 |
| Import / export | §4.42–4.46 | §5 | §5 |
| Backups / sync / profile | §4.47–4.52 | §6 | §4 |
| Onboarding / paywall / feedback | §4.53–4.58 | — | §6, 7 |
| Widgets | §5 | — | §9 |
