# A reference desktop messenger: what Cashfold can learn from it

**Subject**: a popular native macOS messaging client (Swift/AppKit, direct-download build), referred to below as "the reference app".
**Date**: 2026-10-31
**Purpose**: find product, UX, security and desktop-integration ideas that fit Cashfold, and say plainly which ideas to leave alone.
**Audience**: the Cashfold team (product and engineering).

## 1. How this was done, and its limits

Four read-only analyses were run on the installed app bundle, one per area: architecture and stack, features and UX, security and privacy, and desktop-native integration. They used only inspection tools (`ls`, `plutil`, `codesign -d`, `otool -L`, `nm`, `strings`, `assetutil`) and the bundle's English localisation file.

- The app was **not run**, nothing was sent over the network, and the bundle was not modified.
- **No secrets were recorded.** The bundled analytics config and update public-key files were deliberately not opened.
- **No code or assets were copied.** Only short string keys and file names are cited as evidence. The reference app's code and artwork are licensed and trademarked by their owners; this document describes *ideas*, and anything built from it must be Cashfold's own work.
- Behaviour is **inferred from strings, symbols and resource names**, not observed. Items marked *(inferred)* could not be confirmed from the bundle. Examples: whether the app hides its window in the app switcher, and what the bundled Firebase config is enabled for.
- The reference app is a social messenger with a hybrid trust model. Cashfold is a zero-knowledge finance app. The analogies below are chosen to fit Cashfold's constitution; each one that needs care says so.

## 2. Summary

The reference app's depth is not in system integration, which is thin: one share extension, no widgets, no Shortcuts. It is in **settings granularity, honest copy, keyboard-first navigation, and visual polish**. For Cashfold the most valuable lessons are these.

| # | Idea | Why it matters for Cashfold | Impact | Effort |
|---|------|-----------------------------|--------|--------|
| 1 | **Command palette (Cmd/Ctrl+K)** with Recent and Frequent sections and action commands | Fastest way to reach accounts, envelopes, goals and "Add transaction" | High | M |
| 2 | **Privacy mode**: mask balances and amounts until revealed, and generic notification text | Finance data on screen in public; strong trust signal | High | M |
| 3 | **Transaction templates** typed as shortcuts (`/coffee`) | Most entries repeat; speeds up the main task | High | M |
| 4 | **Scheduled-entries queue polish**: Post now, Reschedule, Cancel all, reminders without posting | Builds on the existing schedule inbox | High | M |
| 5 | **Export wizard** with per-section explanations, format choice and progress | A zero-knowledge trust feature; builds on CSV/backup | High | M |
| 6 | **Honest failure copy**: "nothing was changed", plain loss warnings | Cheap and builds trust | High | S |
| 7 | **Step-up re-authentication** for sensitive actions (reveal Secret Key, export, delete) | Limits damage from an unlocked, unattended session | High | M |
| 8 | **Account groups with include/exclude rules**, colour tags and icons | Extends the Accounts-by-group view | Med | M |
| 9 | **Multi-profile switching** with a per-profile accent color | Builds on sign-out/switch account and the new primary color | Med | M |
| 10 | **Row-level screen-reader sentences** and a large-text option | Accessibility is part of "done" in the constitution | High | M |
| 11 | **Global quick-add hotkey** and a configurable dock/tray badge (desktop) | Feasible in Electron; high daily value | High | S–M |
| 12 | **Share extension and balance widget** (native Swift) | The two biggest gaps versus a native app; need native code | High | L |

## 3. What the reference app is

- **Technology**: native Swift/AppKit, one 240 MB universal (Intel + Apple silicon) binary, about 70 feature and library modules (chat, settings, search, wallet and so on) compiled in. GPU effects and a few UI kits ship as small separate resource bundles. A Rust engine and C/C++ libraries (WebRTC, ffmpeg, an animation renderer) are linked in.
- **Packaging**: Developer ID signed, hardened runtime, notarised and stapled, **not sandboxed**, with minimal entitlements (camera, microphone, location, two app groups). The only plug-in is a **sandboxed share extension** that shares an app group with the host. Updates use Sparkle 1.x with a legacy DSA signature on a single feed.
- **Content**: 381 animated vector icons (Lottie-based), about 1,300 vector assets, 22 notification tones, 9 3D scenes, and GPU shaders for effects such as a particle "dust" on delete.
- **Localisation**: only English strings ship in the bundle. The other language folders are empty stubs, so the real language packs are downloaded at runtime.
- **Trust model**: hybrid. Cloud chats are readable by the server; only "secret chats" are end-to-end encrypted and device-bound. The local database uses SQLCipher. A Firebase analytics config is bundled.

## 4. What Cashfold already has

Before adopting anything, note what exists so ideas are not duplicated. Where the code was checked, the location is given; items marked *(verify)* were not.

| Area | Cashfold today |
|------|----------------|
| Auto-lock and lock policy | Idle lock and system-event lock in the desktop shell (`ui/desktop/idle-lock.ts`, ADR-0012); optional "hide content when I switch window" |
| Quick unlock | `us1-quick-unlock` flow |
| Devices | A devices screen and add-device flow (`ui/devices/`) |
| Recovery | Emergency Kit with QR and copy handling (`ui/emergency-kit/`) |
| Data | Backup, CSV import and CSV export (`ui/data/`) |
| Keyboard help | A Help dialog with shortcuts (spec 008) |
| Desktop presence | Tray/menu-bar item, dock badge, jump list, `cashfold://` links, drag and drop, custom frame, theme mirroring (specs 006, 007) |
| Scheduling | Schedules, a schedule inbox banner, goals |
| Guards | An unsaved-changes guard (`transactions/dirty.ts`); filters; account groups view (spec 012); account balances in dropdowns (spec 013) |
| Appearance | Light/dark/system, **primary color with matching icons** (spec 014), reset interface settings |
| Multi-account | Sign out and switch account (spec 011); local-only accounts (spec 010) |
| Install and updates | Installable web app (spec 009); signed desktop updates (ADR-0010) |
| Undo | **Deliberately absent**: status messages "offer no undo" (clarification in the spec for the status area). Any undo idea needs a decision to reverse that. |

## 5. Ideas by theme

Impact is H/M/L and effort S/M/L, for Cashfold. "E" means feasible in Electron/web; "N" means native code is needed. Evidence is a short string key or asset name from the reference app.

### 5.1 App lock and sensitive actions

Cashfold already locks on idle and system events. The additions are about *how* it locks and *what needs a fresh check*.

| ID | Idea | Evidence | Impact | Effort | Notes |
|----|------|----------|--------|--------|-------|
| S1 | **Step-up re-authentication** before: reveal Secret Key, export, change password, delete account, remove a member | `ConfirmWithPasscode`, `WalletInfo` | H | M | "Remember for N minutes" is optional (`Checkout.SavePasswordTimeout`) |
| S2 | **Lock-now shortcut** (Cmd/Ctrl+L) and a lock item in the menu | `ShortcutsController.Others.LockByPasscode` | H | S | Check whether it already exists in the menu |
| S3 | **Biometric unlock that only unwraps a key** (Touch ID in Electron; WebAuthn PRF on the web) | `LAContext`, `Passcode.UseTouchId` | M | M | Must never replace the master secret; require the password after a restart or N unlocks |
| S4 | **Escalating cooldown** after wrong attempts, with short neutral errors | `PasscodeController.Cooldown_other` | M | S | |
| S5 | **Blunt loss warning** when setting up or skipping recovery | `TwoStepAuth.EmailSkipAlert` ("No, seriously… no way to restore it") | H | S | Pair with Emergency Kit acknowledgement |
| S6 | **Hide content in the app switcher** (`setContentProtection`) as a toggle, plus blur when hidden | Not seen in the reference app *(inferred)* | M | S | The reference app does not do this clearly; Cashfold can do better |
| S7 | **Fresh-session guard**: a just-created session cannot revoke older ones for some hours | Sessions copy | M | M | Needs server session metadata only |
| S8 | **Idle expiry of sessions** with a configurable period | `RecentSessions.TTL.Header` | M | M | |
| S9 | **Show failed or incomplete sign-in attempts** to the owner | `IncompleteAttemptHeader` | M | M | Metadata only; keeps zero-knowledge |
| S10 | **Key-fingerprint check** when adding a member device to a shared Fold | Secret-chat "Encryption Key" screen | M | M | Defends against a malicious relay |
| S11 | **Cancellable cooling-off period** for account *reset or deletion* (never for key escrow) | `TwoStepAuth.ResetPending` | L | M | Cashfold has no server recovery by design |

### 5.2 Privacy in everyday use

| ID | Idea | Evidence | Impact | Effort | Notes |
|----|------|----------|--------|--------|-------|
| P1 | **Privacy mode**: blur or mask balances and amounts until clicked; a toggle and a shortcut | Wallet amount blur effect; `Notification.LockedPreview` | H | M | E: CSS blur plus a pref; also apply on lock or window blur |
| P2 | **Generic notification text by default** ("Cashfold has an update"), no amounts or merchants, opt-in preview | `NotificationSettings.MessagesPreview` | H | S | Local scheduling only; no push server holding plaintext |
| P3 | **Purpose-specific permission prompts** that say processing is local | "Recognition happens on your Mac whenever possible" | M | S | For camera or file access in receipt scanning |
| P4 | **Warn before fetching remote content** (exchange rates, receipt links) | `Chat.File.QuickLook.Malf` | L | S | Cashfold's rate refresh is the one network call |
| P5 | **Per-member visibility** in shared Folds with "Everyone (−2)" style summaries | `LastSeenContactsMinusPlus` | M | M | Spec-level feature, not a quick win |

### 5.3 Search, navigation and quick actions

| ID | Idea | Evidence | Impact | Effort | Notes |
|----|------|----------|--------|--------|-------|
| N1 | **Command palette** (Cmd/Ctrl+K): jump to account/envelope/goal and run actions; Recent and Frequent sections; placeholder shows the shortcut | `QuickSwitcher.*`, "Search (⌘K)" | H | M | E. Highest-value navigation idea |
| N2 | **Filter chips** in transaction search (account, category, amount range, payee, tag) with "Clear filter" | `Search.Filter.*` | H | M | Extends the existing filters |
| N3 | **Settings search with synonyms** ("theme" finds Appearance, "lock" finds security) | `SettingsSearch.Synonyms.*` | M | S | |
| N4 | **Recent searches** stored locally, with a clear button | `Search.Confirm.ClearHistory` | L | S | |
| N5 | **Pin** a few accounts or envelopes to the top, with an error that points to groups | `ChatList.PinErrorNew2` | M | S | |
| N6 | **Reopen the last view on launch** | `GeneralSettings.OpenLatestChatOnLaunch` | L | S | |
| N7 | **Hide unused sections** (for example Goals, Schedules) | `GeneralSettings.ShowCallsTab` | M | S | |

### 5.4 Entering and scheduling transactions

| ID | Idea | Evidence | Impact | Effort | Notes |
|----|------|----------|--------|--------|-------|
| T1 | **Templates triggered by a typed shortcut** ("/coffee" → payee, amount, category, account) | `Business.QuickReply.Header` | H | M | |
| T2 | **Smart amount parsing** ("12.5 + 3", "20 EUR") with a toggle | Input replacements | M | M | Exact-money rules apply: integer minor units, one rounding rule |
| T3 | **Option-click Save to schedule**; "Scheduled for today" wording | `Mouse.ScheduleMessage`, `Schedule.SendToday` | M | S | |
| T4 | **Schedule queue actions**: Post now, Reschedule, Cancel all | `Chat.Context.Scheduled.SendNow` | H | M | Builds on the schedule inbox |
| T5 | **Reminder-only schedules** ("Rent due") that nudge without posting | `Chat.Send.SetReminder` | M | S | |
| T6 | **Post when synced or when a rate is available** | `Schedule.SendWhenOnline` | M | M | Fits local-first and multi-currency |
| T7 | **Drafts shown with a "Draft:" prefix** in the list, and "Delete all drafts" in Privacy | `ChatList.Draft`, `PrivacyAndSecurity.ClearCloudDrafts` | M | S | Drafts stay local |
| T8 | **Enter vs Cmd+Enter to save**, and "save silently" for a shared Fold | `GeneralSettings.SendByCmdEnter` | M | S | |
| T9 | **Undo** after delete or transfer, **edit last**, and double-click to repeat | `Chat.UndoManager.Undo`, `EditLastMessage` | H | S | **Conflicts with the existing "no undo" decision**; decide first |

### 5.5 Groups, folders and views

| ID | Idea | Evidence | Impact | Effort | Notes |
|----|------|----------|--------|--------|-------|
| G1 | **Account groups with include/exclude rules** (type, currency, tag), drag to reorder, safe-delete wording ("Your accounts will not be deleted") | `ChatList.Filter.Include.Desc`, `Confirm.Remove.Text` | H | M | Extends spec 012 |
| G2 | **Group colour tags and an icon set** shown as small chips on rows | `ChatList.Folder.Tags`, `menu_folder_*` | M | S | |
| G3 | **Archive** closed accounts and finished goals, with a rule for whether new activity un-archives them | `Archive.Tooltip.*` | M | S | |
| G4 | **Share a subset of a Fold** (chosen accounts) through an encrypted invite, and explain why rule-based groups cannot be shared | `ChatList.Filter.InviteLink.Share`, `IncludeExcludeError` | M | L | Zero-knowledge compatible with care |
| G5 | **Two views of one data set** (by account / flat ledger) and inline tag rename | `ViewAsChats`, `menu_tag_rename` | M | M | |

### 5.6 Data, storage and export

| ID | Idea | Evidence | Impact | Effort | Notes |
|----|------|----------|--------|--------|-------|
| D1 | **Export wizard**: choose accounts, date range and format (CSV, JSON, readable HTML/PDF), one explanatory line per section, "{done} of {total}" progress | `ExportData.*` | H | M | Build on `ui/data/`; keep export next to deletion, with a "export first" hint |
| D2 | **Local data usage screen**: ledger, attachments, caches, rate history, per-category clear, calm copy when small | `StorageUsage.*` | M | M | |
| D3 | **Attachment retention policy** with the reassurance that synced copies stay in the encrypted store | `StorageUsage.KeepMedia` | M | M | |
| D4 | **Sync data usage** and "attachments on Wi-Fi only" | `DataAndStorage.AutomaticDownload.*` | L | M | |
| D5 | **Honest migration screen** ("optimising… this may take a few minutes, sorry") instead of a silent freeze | `UpgradeDatabase.Text` | M | S | |
| D6 | **Crash-on-launch escape hatch**: reset the local cache and re-sync without wiping the vault | `CrashOnLaunch` dialog | M | M | |
| D7 | **Opt-in export delay** for a shared Fold that notifies all members' devices | `ExportData.DelayText` | L | M | |

### 5.7 Appearance and polish

| ID | Idea | Evidence | Impact | Effort | Notes |
|----|------|----------|--------|--------|-------|
| A1 | **Per-profile accent color** so people see which profile or Fold they are in | `GeneralSettings.AccentColor` | M | S | Builds on spec 014 |
| A2 | **"Tinted" surfaces**: neutrals pick up a hint of the accent | `AccentColors.Tinted` | M | M | Needs a contrast test per color |
| A3 | **Separate light and dark variants** (for example a pure-black dark) | `DefaultDark`, `DefaultDay` | M | S | |
| A4 | **Text size and row density** (Compact / Comfortable) with a live sample list | `AppearanceSettings.TextSize.Header` | H | M | Also serves accessibility |
| A5 | **Reduce motion / reduce blur** toggles, with an automatic mode on low battery | `LiteMode.*` | M | S | Electron `powerMonitor` |
| A6 | **Scheduled dark mode** (from/to) in addition to follow-system | `AutoNight.Settings.*` | L | S | Skip sunrise/sunset: it needs location. Its string says it is stored locally, but a finance app should not ask |
| A7 | **Theme export/import** as a small JSON file | `Appearance.ExportTheme` | L | M | A link-based gallery is out of scope |
| A8 | **Preset icon gallery** beyond one icon per color (gradients and layered variants) | `AppIcon` layers: Plane, Oval, Gradient-1..4, Color-1..8 | M | S | Extends spec 014's pre-rendered icons |
| A9 | **Animated empty states and menu icons** (Lottie or SVG, subtle, respecting reduce motion) | Animated empty-state and menu assets | L | M | Keep the bundle small |
| A10 | **Reset per settings section** with "undo all custom settings" wording | `Appearance.Reset` | L | S | |

### 5.8 Notifications, sounds and badges

| ID | Idea | Evidence | Impact | Effort | Notes |
|----|------|----------|--------|--------|-------|
| B1 | **Configurable dock/tray badge**: choose what it counts (due today, overdue, over-budget) | `BadgeDesc`, `IncludeMutedChats` | H | S | E: `app.setBadgeCount` |
| B2 | **Notification tone catalogue** of 6–10 short tones with a preview, "None" and "Default"; a separate in-app sounds switch | 20 named tones, `GeneralSettings.InAppSounds` | M | M | Do **not** copy the "upload your own sound" feature unless wanted |
| B3 | **Short confirmation sounds** (saved, goal reached, over budget) | `sent.mp3`, `confetti.mp3` | L | S | Off by default |
| B4 | **Actionable notifications** ("Mark paid", "Skip this occurrence", "Snooze") | `Notification.Reply` | H | M | |
| B5 | **Snooze durations** (1 hour, 2 days, until a date) for alerts and reminders | `ChatList.Mute.Until` | M | S | |
| B6 | **No system notification while the window is focused** | `NotificationSettings.Snoof` | M | S | |
| B7 | **Per-profile notification routing** ("all profiles" vs the active one) | `NotificationSettings.AllAccounts` | M | S | Needs multi-profile first |

### 5.9 Desktop-native integration

| ID | Idea | Evidence | Impact | Effort | Where |
|----|------|----------|--------|--------|-------|
| X1 | **Real menu-bar menu with accelerators** (New transaction Cmd+N, Search Cmd+K, Lock Cmd+L, Go to account Cmd+1..9) | `MainMenu.nib` | H | S | E (`Menu`) |
| X2 | **A "Keyboard Shortcuts" settings page** grouped by area, plus mouse and gesture rows | `ShortcutsController.*` | H | S | E. Cashfold has a Help dialog; extend it |
| X3 | **Global quick-add hotkey** that works while unfocused, in a small window | Push-to-talk global key | H | M | E (`globalShortcut`) |
| X4 | **Menu-bar item showing today's spend** as title text, opt-in | `GeneralSettings.StatusBarItem` | M | S | E (`Tray.setTitle`) |
| X5 | **Quick Look-style attachment preview** on Space | "Open in Quick Look" | M | S | E (`BrowserWindow.previewFile` on macOS) |
| X6 | **Drag a transaction row out** as CSV/PDF | Drag and drop handling | M | M | E (`webContents.startDrag`) |
| X7 | **Share extension**: send text, a URL or a receipt image to create a pending transaction | Share extension bundle | H | L | **N** (Swift extension, sandboxed, app group) |
| X8 | **Balance widget** (total balance, month spend, next bill) | `WidgetUI` module, no real widget | H | L | **N** (WidgetKit) |
| X9 | **Spotlight indexing** of accounts, payees and recent transactions | CoreSpotlight linked | M | M | **N** |
| X10 | **Shortcuts/Siri intents** ("Add expense", "Show balance") | Not present in the reference app | M | L | **N** |
| X11 | **Show the update affordance in-app** and stable/beta channels | `Icon_AppUpdate`, `SOURCE=STABLE` | L | S | E (`electron-updater` channels) |

### 5.10 Accessibility

| ID | Idea | Evidence | Impact | Effort |
|----|------|----------|--------|--------|
| Y1 | **Row-level screen-reader sentences** with context and plurals: "Groceries, minus 42 euros, yesterday, Checking"; "3 overdue bills" | 322 `VoiceOver.*` strings | H | M |
| Y2 | **Large-text option** | `GeneralSettings.LargeFonts` | M | S |
| Y3 | **List-row swipe actions** (post, skip, delete) as touch and keyboard alternatives | Gestures section of the shortcuts page | M | M |

### 5.11 Voice and microcopy

The reference app's copy is short, second person and consistent. Adopt it as a voice guide:

- **Say what did not happen**, then what to do: "Your card has not been billed." → "Nothing was changed."
- **Name the object and the consequence** in confirmations, and repeat the verb on the button ("Clear all", not "OK").
- **State both outcomes for every toggle** ("Turn this off if…" / "Turn this on if…").
- **Plain privacy claims**: "stored locally on your device", "only you can read this".
- **Empty states explain what will appear** and offer one action link.
- **Friendly progress copy** for slow work ("This can take a few minutes").
- **Safe-delete wording**: "Your accounts and transactions will not be deleted."

### 5.12 Architecture, packaging and release

| ID | Idea | Evidence | Impact | Effort |
|----|------|----------|--------|--------|
| R1 | **Build separate arm64 and x64 desktop packages** instead of one fat build | Universal binary is 66% of the bundle | M | S |
| R2 | **Keep entitlements minimal** and never disable library validation | Entitlements list | M | S |
| R3 | **Sandbox any future helper** and share data through an app group, never re-embed the core in it | The share extension is 87 MB because it duplicates the core | M | M |
| R4 | **One update feed and in-app channel logic**; sign update metadata with modern keys | Sparkle setup (but it uses legacy DSA) | M | S |
| R5 | **Bundle English and load other languages lazily**, still offline | Empty `.lproj` stubs and runtime language packs | L | M |
| R6 | **An allowlist of external URL schemes** for `shell.openExternal` | `url-schemes.txt` | M | S |
| R7 | **Split the monorepo further by domain** and keep a headless core with a typed facade | ~70 modules, a core library plus a storage library | L | L |
| R8 | **Check the packaged app for secrets in CI** | Bundled analytics config | M | S |

## 6. What not to copy

| Do not copy | Why |
|-------------|-----|
| **Third-party analytics or verification SDKs** (Firebase) | Breaks "no third-party scripts, analytics or session replay" and the strict CSP |
| **Relaxed transport or CSP rules** (`NSAllowsArbitraryLoads`) | Keep connect-src allow-listed |
| **Unsandboxed app with broad entitlements** (always-on location, Downloads folder) | Keep Electron sandbox, context isolation and minimal permissions |
| **Server-readable data, server-side previews, OCR or speech** | No feature may need plaintext to leave the device |
| **Server-side email recovery of the data key** | Cashfold's recovery is the Secret Key and Emergency Kit only |
| **Legacy DSA / Sparkle 1.x update signing** | Use modern signatures (Cashfold already does) |
| **Phone number and SMS as identity** | SIM-swap risk; keep SRP plus Secret Key |
| **A short passcode as a separate secret for the same data** | A PIN may only rate-limit a local key unwrap, never replace the master secret |
| **A hybrid "some encrypted, some not" model** | Default-everything-encrypted is a feature |
| **Export hidden in another client** | Keep export in the main app |
| **Location for cosmetic features** (sunset-based dark mode) | A finance app should not ask for location |
| **A social-style premium unlock for icons and themes** | Customisation stays free and local |

## 7. Suggested order of work

Each line is a candidate spec. Earlier items are cheaper, higher-value, or unblock later ones.

1. **Voice and failure copy pass** (S5, 5.11): wording only, immediate trust gain.
2. **Menu accelerators and a Shortcuts page** (X1, X2, S2): small, high daily value, desktop.
3. **Command palette** (N1, N3, N4): the biggest navigation win.
4. **Privacy mode and generic notifications** (P1, P2, S6): masks balances; hides content in the switcher.
5. **Step-up re-authentication** (S1, S4): needs a short design note first.
6. **Configurable badge, global quick-add hotkey, actionable notifications** (B1, X3, B4, B5): desktop engagement.
7. **Templates and smart amount parsing** (T1, T2, T8): entry speed.
8. **Scheduled-entries queue actions and reminders** (T3–T6): finishes the schedule story.
9. **Export wizard** (D1, D2, D5): next to deletion, with clear explanations.
10. **Account groups with rules, colours and archive** (G1–G3): extends spec 012.
11. **Appearance depth** (A1–A5, A8): per-profile accent, text size, density, reduce motion; extends spec 014.
12. **Multi-profile switching** (A1, B7): after the above.
13. **Accessibility pass** (Y1–Y3): can run in parallel with any of the above.
14. **Device and session hardening** (S7–S10): needs server metadata work and a threat-model note.
15. **Native extras** (X7–X10): the share extension and balance widget, as the first native investments.

## 8. Decisions this document needs from the team

- **Undo (T9)**: the existing status area is explicitly "no undo". Reverse that, or keep it and skip T9.
- **Biometrics (S3)**: acceptable only as a convenience that unwraps a key. Confirm that rule before any design work.
- **Notification sounds (B2)**: are sounds in scope at all for a finance app, and if so, off by default?
- **Native code (X7–X10)**: is the project willing to add Swift targets and an app-group data exchange? The constitution says no shell may require changes to `core`, `crypto` or `protocol`; a native extension must respect that.
- **Sync of preferences**: several ideas (accent per profile, privacy mode, pinned items) are device preferences today. Syncing them would need the personal-settings design that spec 014's deferred phase describes.

## 9. Source notes

The four underlying reports (architecture, features and UX, security and privacy, desktop-native) were produced by read-only agents and kept outside the repository. Their detail is folded in above. To reproduce any finding, the evidence strings are listed in each table's "Evidence" column and can be found with `plutil -p` and `strings` on the bundle's `Info.plist` and `en.lproj/Localizable.strings`.
