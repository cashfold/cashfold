# 01 — Navigation and Screens

Evidence tags: **[S]** label/string exists, **[M]** class/selector/ivar exists, **[I]** inferred, unverified at runtime. See [README](README.md#2-evidence-levels-read-this-before-using-a-statement-as-a-requirement). Quoted text is the English string; the key is in `code` where useful. Class names are the original ones, kept so the findings can be traced.

---

## 1. App shell

### 1.1 Entry and lifecycle
- Single-window iOS scene app (`SceneDelegate`, multiple scenes disabled) [M].
- Launch: static `LaunchScreen.nib` plus a launch logo. When an auth requirement is set, `LockScreenViewController` is shown over the content (§4.33). `LoadingViewController` is used during data migration/startup [M]. 26 Core Data model versions imply lightweight/staged migration on startup, plus a settings migration (`SettingsDidMigrate`) and a keychain migration (`KeychainDidMigrate`) [M].
- Background: `fetch` background mode with BGTask id `the app's refresh BGTask id` (sync/refresh) [M]. `AppBackgroundManager` [M].
- Home-screen quick action: **"Add Transaction"** (`plus.circle.fill`, type `…quick-action.add-transaction`) opens the new-transaction editor [M].
- Opens/handles **CSV files** (document type "CSV File", open-in-place) and routes them to import (`AppRouter goToImportWithFileURL:`) [M].
- First run: demo data is added (see §4.54 and [02 §7](02-data-model-and-rules.md)) together with a banner (`DemoDataBanner`). The user can remove it [S].

### 1.2 Global banner area
`BannerService` + `AppRouter configureBannerState/showBanner/hideBanner` show a **bottom banner** above the content [M]. Known banner types (by strings and types) [S/M]:
- Demo data banner: "To help you get familiar with the app's features, we have added example data. When you are ready, remove it to start from scratch." Action: "Remove Now" (`_deleteDemoDataNow`).
- PRO upgrade banner (`ProUpgradeBanner`): "Save on your subscription" (annual-plan upsell).
- Layout-migration banner (`LayoutMigrationBanner`): "We've added a new navigation type to the app. Would you like to try it?" with buttons "Yes, try it" / "Later". After accepting: "You can change the navigation type here: Settings ▸ Appearance ▸ Navigation".
- App-rate pre-prompt (`AppRatePrePromptTableViewCell`, `_appRatePrePrompt*`): "Do you like the app?" → Yes / Not really (§4.58).
- Promo campaigns (`ZFPromoService`, `showPromoCampaign:`) [M].

### 1.3 Main sections ("navigation points")
Five top-level sections [M: `AppRouter` holds `accountsNC/VC`, `transactionsNC/VC (MainScreenViewController)`, `planNC/VC (GoalsBudgetsViewController)`, `reportNC/VC (OverviewDetailsViewController)`, `settingsNC/VC`]:

| Section | Root screen | Purpose |
|---|---|---|
| Accounts | `AccountsViewController` (§4.1) | Account/group list, balances, current-account selector |
| Transactions | `MainScreenViewController` (§3) | Dashboard plus transaction list for the current account/group |
| Plan | `GoalsBudgetsViewController` (§4.15) | Goals and budgets |
| Report | `OverviewDetailsViewController` (§4.10) | Charts and category/tag/counterparty/place breakdowns |
| Settings | `SettingsViewController` (§4.29) | All configuration |

### 1.4 Navigation layouts (user-selectable, `_appNavigationLayout`)
Settings ▸ Appearance ▸ **Navigation**: "Classic" or "Tabs" [S]. A third, size-class-driven layout is used on iPad/Catalyst [M].

1. **Classic** (`ClassicAppRouter`, `DrawerController` built on MMDrawer) [M]:
   - The main screen is the center.
   - A **left drawer** holds the accounts list. The tooltip is "CURRENT ACCOUNT swipe to the right →", and the tooltip for the accounts list is "YOUR ACCOUNTS LIST select current account or group" [S].
   - Plan, Report, Settings, Search and Add are reached through nav-bar buttons on the main screen (`_chartButton`, `_goalsBudgetsButton`, `_searchButton`, `_menuButton`, `_settingsButton`, `_addButton`, plus the "More" menu "More options & features") [M].
   - Right drawer exists (`MAINSCREEN_RIGHT_DRAWER_ANIMATION_TYPE`) and the drawer animation types are configurable [M].
2. **Tabs** (`TabsAppRouter`, `UITabBarController`) [M]:
   - A tab bar with Transactions / Report / Plan / Settings, plus a **center "New Transaction" tab item** that does not select a tab. It presents the editor (`dummyNewTransactionVC`, `configureNewTransactionTabBarItem`) [M/I].
   - The tab bar shows a **badge** (`updateTransactionsBadge`), most likely the count of pending-confirmation scheduled transactions [I].
   - Accounts are available in a **sidebar drawer**, with a demonstration animation on first use (`startAccountsSidebarDemonstration`) [M].
3. **Column / split layout** (`ColumnAppRouter`, `SplitViewController` double and triple columns, `SidebarViewController`) for iPad and Mac Catalyst [M]:
   - Sidebar (sections) → supplementary column (accounts) → detail. Column widths are persisted (`saveColumnWidths/restoreColumnWidths`). The sidebar can be hidden. Settings, Export, Help and Debug are reachable from the sidebar [M].

**Add-transaction button position** (`_addTransactionButtonPosition`): Left / Center / Right [S]. It is a floating button (`AddTransactionFloatingButton`) on Transactions, Plan and Report [M].

### 1.5 Presentation conventions [M/I]
- Editors (account, group, category, tag, counterparty, goal, budget, transaction, schedule) are presented modally in their own navigation controller. They have a **Save** bar button, a close or cancel control, and a **dirty check**: `rememberInitialState` / `isDataChanged` / `checkForDataChanging` enable Save only after a change and trigger a discard confirmation on close.
- iPad/Mac: Escape key closes editors (`performEscapeKeyNavigation`) [M].
- Pickers for category, account, currency, tags and counterparties are the same list screens as the management screens, with a **selection callback** (`selectCompletion`, `selectAction`) and optional multi-select limits [M].
- Deletion always goes through a confirm dialog (§6.2 for the texts).
- Empty states use `EmptyStateTableViewCell` / `NoDataView` with the strings listed per screen.
- Keyboard handling uses IQKeyboardManager plus a custom `ZFKeyboardManager`, and **a custom calculator keypad** (`HWKeypadView`) for amounts (§6.1).

---

## 2. Shared UI components (referenced by screens)

| Component | Behavior | Evidence |
|---|---|---|
| **Period selector** (`HWPeriodSelectorTableViewCell`, `OptionsSelectorView`) | Horizontal scroller of periods with a current-period marker. Supports period *groups* (below), prev/next, "show all periods", and a custom range. | [M] |
| **Period groups** (`PeriodGroup`, `PeriodsViewController`) | "Current Periods" (This/Last/Next Week, This/Last/Next Month, quarters, years…), "Recent Days" (Last N days), "Complete History" ("All transactions through the end of today"), "Custom". | [S] `_periodGroupActual`, `_periodGroupLastDays`, `_periodTypeAll(Descr)`, `_periodTypeCustom` |
| **Custom period** (`CustomPeriodViewController`) | Two rows "Start" and "End" with inline date pickers; Done/close. The end picker's minimum is the start date. | [S/M] |
| **Account selector** (`AccountSelectorView`) | Nav-bar title control showing the current account or group (icon plus name). It opens the accounts list. | [M] |
| **Dashboard grid** (`DashboardGridTableViewCell`, 4 items) | Four tiles: **Income**, **Expenses**, **Period Balance**, **Current/Total Balance**. A tap on a tile opens the matching detail (`performDashboardActionFor…`). A "modern dashboard" flag selects the grid vs. the legacy two-row cells (`HWDashboardTableViewCell`). | [M] |
| **Info tips / tooltips** (`InfoTipManager`, `TooltipsHelper`, `InlineTipsCoordinator`) | Coach-mark sequences per screen (Main, Accounts, Plan, Report). The strings are in [03 §10](03-settings-sync-pro-system.md). Also dismissible inline tips inside edit screens. | [S/M] |
| **Amount keypad** (`HWKeypadView`, `HWKeypadExpressionItem`) | In-app numeric keypad with expression evaluation (`keypadExpressionDidChanged:sum:`), currency switching (`keypadCurrencyDidChanged:`), and cancel. Optional fixed decimal entry (§4.30). | [M] |
| **Icon + color picker** | `IconBundlesViewController` → `IconsViewController` (§4.40), `ColorsViewController`, `HWColorPalette` (numbered palette, 0–24+). | [M] |
| **Pull-to-action** (`PullToActionView`) | Pull on the main list triggers an action (`pullToActionViewDidTriggerAction`). It is probably "add transaction" or "show all". | [M/I] |
| **Context menus** | Rows on Main, Transactions list, Accounts and Plan have `contextMenuConfigurationForRowAtIndexPath` (long-press menus: edit, duplicate, delete, pin, etc.). | [M] |
| **Search controller** | Used in Categories, Tags, Counterparties, Currencies, Search. | [M] |

---

## 3. Main screen — Transactions (`MainScreenViewController`)

The home screen. A single table (`HWDynamicTable`) composed of: **period selector cell → dashboard → transaction-list header → transaction list** [M].

**Nav bar** [M/S]:
- Title: the account selector (current account or group; "All Accounts" is available when selection of all is allowed (`allowSelectAllAccounts`)).
- Right/left buttons (depends on layout): Add (`_addButton`), Search, Report ("chart" button), Plan ("goals/budgets" button), Settings, and a **More menu** (`_menuButton`, tooltip "Find additional options here" / "More options & features") [M/S].
- Screen options (`screenOptionsAction`) opens Main Screen Options (§4.9).
- Floating add button (`configureFloatingTransactionButtonIfNeed`) [M].

**Period cell**: Period selector (§2) controlling `mainPeriod` (`setMainPeriod:`, notification `_MAIN_PERIOD_CHANGED`). The period type is persisted (`MAIN_PERIOD_TYPE`, `MAIN_PERIOD_SELECTOR_GROUP_TYPE`, `…_OFFSET`). A "current period" mode (`MAIN_BALANCE_PERIOD_CURRENT`) exists [M]. Month boundaries respect the **first month day** setting (§4.30).

**Dashboard** [S, tooltip texts]:
- Income: "Total income for the selected period".
- Expenses: "Total expenses for the selected period".
- Period Balance: "Income minus expenses for the selected period".
- Current Balance: "Sum of transactions through the end of today, plus the initial balance of the account(s)". Date variant: "Balance on <date>": "Sum of transactions through the end of the selected period, plus the initial balance of the account(s)".
- The sums are computed on background operations (`SumCalculationOperation`, `BalanceCalculator`). Multiple currencies are converted to the group/general currency, and "Round summary amounts" applies (§4.30) [M].
- Dashboard options (which tiles, balance on/off) come from `DashboardOption` [M].

**Transaction list header** (`HWOptionsSelectorTableViewCell`, `switchTransactionsShowModeTo:`): switch the list between show modes [M/I]:
- All transactions (default) for the period.
- **Significant** ("Significant"): a filtered view (`_significantTransactions`, `isSignificantModeAvailable`) [S/M]. The exact rule is unknown [I].
- **Scheduled** (`isSchdeuledShowMode`, `_includingScheduledShort` = "Incl. Scheduled"), available when schedules exist. It shows upcoming scheduled transactions ("Will be created on <date>") [S/M].
- **Pinned** transactions ("No Pinned Transactions" empty state; `_pin`/`_unpin`) [S].

**List** [M/S]:
- Items are grouped by **day** (`TransactionHeaderTableViewCell`). The day header can show a **daily summary** whose type is configurable: None / Daily Sum / Daily Income / Daily Expenses / Day-End Balance (`_transactionListGroupDetailsType*`). A month separator can be enabled (`isMonthSeparatorEnabled`) [S/M].
- Transaction row (`HWTransactionTableViewCell`): category icon/color, category (+ subcategory), account, note/comment, tags, counterparty, place, amount (styled/colored per sum style §4.39), optional time. Transfers show source→destination. A **refund** indicator, an **adjustment** marker, and **photo/place** attributes are shown when present. Attribute coloring can be turned off ("Use Color for Additional Attributes") [S/I].
- **Pending confirmation rows** (`PendingTransactionTableViewCell`, `UnconfirmedTransactionTableViewCell`): scheduled transactions waiting for manual confirmation, with a **Confirm** action (`_confirmTransaction`, "Pending Confirmation") [S/M].
- **Scheduled rows** (`ScheduledTransactionTableViewCell`): in the scheduled mode [M].
- Tap → edit (§4.5). Context menu → Duplicate / Pin / Delete (confirm: "Are you sure you want to delete this transaction?") [S/M]. Transactions created by a schedule show: "This transaction was created from a schedule" with a link to the origin (`disableOriginOpen`) [S/M].
- Empty state: "No Transactions for the Selected Period". The first-run empty state: "Let's start by creating your first account" → after creation "Account created! You can now add transactions" (`_famInitialMessage`, `_famSuccessMessage`) [S].
- "Show All Transactions" action (`_showAllTransactions`) lifts the limit for non-PRO users (see `_itemsLimitExceededMsgWithPlaceholder`: "Max items allowed: %@") [S/M].

**Actions reachable** [M selectors]: `addTransaction`, `editTransaction:duplicate:mode:`, `showDetails` (opens Report, §4.10, for a type/period), `showAccounts`, `showBudgets`, `showSettings`, `showSearch`, `showAllPeriods`, `showAdjustBalance`, `exportTransactions`, `confirmDeleteTransaction:`.

**State/refresh triggers** [M]: day change, currency-rates update, PRO state change, import done, schedule change, demo data deleted, current account changed, transaction pin, list options changed.

---

## 4. Screen specifications

Each spec lists: **Purpose / Entry / Content / Actions / Rules / Evidence**.

### 4.1 Accounts (`AccountsViewController`)
- **Purpose**: manage accounts and groups, pick the current account/group, and show balances.
- **Entry**: Accounts drawer/sidebar/tab, or from the account selector on any section. It can also be used as a standalone **picker** (`isStandaloneSelector`) from editors.
- **Content**: a list of **groups** (expandable, `expandModeForGroupSid:`) containing **accounts**. Ungrouped accounts are shown too. A footer cell is shown. Each account cell (`HWAccountTableViewCell`) shows icon, color, name and optionally the **current balance** in the account's currency (per-account "Show Current Balance" toggle, §4.2). "Extended" cells with more detail appear when the width allows (`isExtendedDetailsAvailableDueToWidth`). A group cell shows the combined balance in the group's *report currency* [M/S].
- **Actions**: select an account or group (sets the *current* account/group for Transactions and Report [S: "Select the current account or group for the 'Transactions' and 'Report' sections."]). Add menu: **Add Account** / **Add Group** (tooltip "Add a new account or account group"). **Edit mode** (toggle; tooltip "Edit the accounts list"): reorder by drag, reorder accounts across groups, open edit. Context menu per account: edit, **Adjust Balance**, **add transaction**, **export transactions** (`exportTransactionsForAccount:group:`), toggle balance for all accounts [M].
- **Rules**: free users see only a limited number of accounts: "Only one account is available for free" / "Only two…" / "Only a few…" (the number is A/B-tested, `_accountsLimitedPROWarning1/2/3`). Non-free accounts are locked (`isProOrDemoAccount`, `freeAccountSids`). Reordering has a "allowed for reordering" status check [S/M].
- **Empty state**: "Create an Account" (`_createAccount`) [S].
- **Info tip**: "Here you can manage all your accounts: create new ones, change their order, and group them…" [S].

### 4.2 Account editor (`AccountEditViewController`)
- **Fields** (in table order [M ivars]): **Name** (text; hint "For example, 'Cash' or 'Card'."), **Initial Balance** (`_openingBalance`; amount cell with the keypad; sign allowed [I]), **Currency** (opens Currencies §4.27; there is a "General Currency" option when allowed `allowGeneralCurrencyOption`), **Icon** (§4.40), **Color** (palette), **Show Current Balance for This Account in the Accounts List** (switch), **Archive** (switch; "An archived account, including all its transactions, is completely hidden and visible only in edit mode on the accounts screen"), **Include in Account Groups** (group checklist; `_accountGroupsToInclude`), and an optional inline tip ("An account represents one of your real accounts, whether it's cash, a bank account, or a piggy bank.") [S/M].
- **Actions**: Save, Delete (shown when editing; message: "Are you sure you want to delete this account? All transactions associated with this account will also be deleted!"), and the number of transactions (`transactionsCount`) is used in the confirmation [S/M].
- **Rules**: the name must be unique ("The name is already in use"). A balance field may need rounding for fixed-decimal currencies (`roundBalanceSum`). Detail type (`detail`) controls the extended info shown in the list [M/I]. Account `internal` flag (default true) marks regular accounts, while goal-linked accounts are created for goals (demo accounts with `isGoal`) [M/I].

### 4.3 Group editor (`GroupEditViewController`)
- **Fields**: Name; **Which Accounts to Include in This Group** (account checklist, `_accountsToIncludeInGroup`); **Report Currency** (`reportCurrency`, the currency in which the group total is shown); **Show Current Balance for This Group in the Accounts List**; transactions count label; Delete button [S/M].
- **Rules**: groups may be used in reports, goals and budgets ("An account group lets you combine several accounts to use them in reports, goals, budgets, etc.") [S]. Delete confirmation: "Are you sure you want to delete this group?" [S]. Accounts are not deleted with the group [I]. PRO check on creation (`showMessageAccountsLimitExceeded`) [M].

### 4.4 Adjust Balance (`AdjustBalanceViewController`)
- **Purpose**: "Adjust the account balance if it differs from the actual balance." Footer: "A special adjustment transaction will be created" [S].
- **Content**: current balance (from `BalanceCalculator`) and an input for the *actual* balance (keypad). It creates a transaction with `adjustment = true` and the difference as its sum [M/I]. Whether adjustments count as income/expenses in reports is controlled by "Adjustments as Income and Expenses" (§4.30) [S].
- **Entry**: account context menu, a Main-screen action (`showAdjustBalance`). PRO feature ("Balance Adjustment") [S].

### 4.5 Transaction editor (Swift `TransactionEditViewController`; fields in `CDTransaction`)
- **Types**: **Expense / Income / Transfer** (segmented control or tabs) [S `_expense`, `_income`, `_transfer`]; **Refund** variant of an expense/income (`_refund`, `refund` flag) [S/M].
- **Amount** (`TransactionAmountInputView`): keypad with expressions. For a transfer there are two amounts and currencies: "Transfer: Amount" and "Transfer: Currency" (`HWTransferInputSumTableViewCell`), with different currencies per side supported [S/M].
- **Fields** (shown or hidden via "Transaction Fields", §4.6) [S/M]:
  - **Account**: for transfers **Source** and **Destination** (`_accountSource`, `_accountDestination`, "Transfer: Account").
  - **Category** (and subcategory; opens Categories §4.22 filtered by expense/income type; "Uncategorized" is allowed unless disabled). Not used for transfers.
  - **Date** and, if enabled, **Time** ("Transaction Time": "Remember the time of the transaction, not just the date").
  - **Tags** (up to 3: `tag1`, `tag2`, `tag3`; opens Tags §4.24 with `maxItemsToSelect`).
  - **Counterparty**: labeled **Payer** for income and **Payee** for expenses (§4.26).
  - **Note** (`comment`).
  - **Photo**: Take Photo / Choose Photo, preview, Delete Photo; stored as an image file ref (`image`). Photos are *not* synced ("Synchronization of images is not supported.") [S].
  - **Place** (geotag): **Detect** / **Update** / **Clear**, "Unknown Place"; uses Location when in use (`latitude`, `longitude`, `place`) [S/M]. If Location is disabled: "Location Services are disabled in Settings" with "Go to Settings" [S].
  - **Repeat / Schedule**: "Create Schedule" from a transaction. A "Scheduled Transaction Created" confirmation says "You can find all scheduled transactions in Settings" [S].
  - **Currency**: per transaction (the account currency by default, `currency`, `usd` normalized amount) [M].
- **Actions**: **Save Transaction** (`_saveTransaction`), Duplicate (PRO: "Duplication of transactions"), Delete (confirm), pin/unpin, and close with discard prompt [S/M].
- **Edit-mode variants** [M `editTransaction:duplicate:mode:`]: new, edit, duplicate, and from a schedule (the editor opens in a schedule context, §4.21). Prefill: the default values (§4.6) and the current account.
- **Rules** [I]: a transfer creates two linked rows (`pair`, `transfer`) so each account's balance changes. Editing one side edits the pair. The `usd` field stores the amount converted into a base currency for cross-currency reports. A transaction affects balances up to the end of "today" for "current balance" and to the period end for "balance on date".

### 4.6 Transaction edit options (`TransactionEditOptionsViewController`)
- Title "Transaction Fields". Switches to show or hide each field of the editor (Category, Tags, Counterparty, Note, Photo, Place, Time…). Footer: "If a field has a value, it will be shown even if it is disabled." Also "Default Values" (`_defaultValues`) for new transactions, and a "Transaction Time" switch [S/M].

### 4.7 Transaction list options (`TransactionListOptionsViewController`)
- Title "Transaction List Options". Sections [S]:
  - **Daily Summary** (`_transactionListGroupDetailsType`): None / Daily Sum / Daily Income / Daily Expenses / Day-End Balance.
  - "Use Color for Additional Attributes" (switch; "Turn off to make the list less colorful").
  - Compact tool view (`_transactionToolsViewCompact`) [S/I].
  - Month separator [M].
- Opened from the nav-bar options of the transaction list.

### 4.8 Generic transaction list (`TransactionsViewController`)
Used for drill-downs from Report (a category/tag/counterparty/place/transfer item for a period), from Budget details (subclass `BudgetDetailsViewController`, §4.17), Search (subclass `SearchViewController`, §4.28), and per-account export. [M]
- **Content**: title and subtitle (e.g. item name and period), the grouped list, an activity indicator while fetching, a limit on rows for non-PRO users (`transactionCountLimit`, "Max items allowed: %@"), an optional "+" button (`showAddButton`), and a menu with List Options and **Export** (`allowExport`, CSV, §4.46) [M/S].
- Tap a row → edit; context menu as in §3.

### 4.9 Main screen options (`MainScreenOptionsViewController`)
- Title "Screen Options". Controls what is shown on the dashboard (`DashboardOption`: for example "Show Balance", "Show Chart", display of balance tiles, the modern grid) and the transaction list [S/M]. The strings: "Show Balance", "Show Chart", "Show Current Balance", "Displayed Attributes" [S].

### 4.10 Report (`OverviewDetailsViewController`)
The analytics section. One table: **period cell → (balance) → chart cell → chart info → param cell → results list** [M].
- **Report type (`ReportMode`)**: switch between **Expenses** and **Income** (`switchToType:`), with the tooltip "Choose a report type", and breakdown **modes** (`switchModeTo:`, `calcSumsForCategoriesAndTransfers`, `calcSumcForTags`, `calcSumcForCounterparties`, `calcSumcForPlaces`) → results by **Category (+ transfers)**, **Tags**, **Counterparties** (Payers/Payees), **Places** [M/S: `_payers`, `_payees`, `_places`, `_tags`]. The tooltip is "REPORT PARAMETERS" [S].
- **Chart**: toggled on/off (`toggleChart`, "Show Chart"); chart type segmented control (tooltip "CHART TYPE") switches **Pie** (`PieChartViewController`, §4.12) and **Bar** (`BarChartViewController`, §4.13) [M/S]. Tapping a slice or bar selects the matching result item (`selectOverviewItem:`) and updates a chart info cell. Small values can be merged into "Other" ("Combine Small Values on the Pie Chart"; "Results under [[percent]] of the total will be combined into the 'Other' section on the chart", `isChartOtherEnabled`) [S/M].
- **Balance** cell (optional, `toggleBalance`): "Balance on <date>" for the period [M/S].
- **Results list**: rows with icon/color, name, amount, percentage of total, and **Transactions Count** (optional). Tap → drill down: **sub-level** (`showSubsForOverviewItem:`: category → subcategories) or the **transaction list** (`showTransactionsForOverviewItem:`, §4.8). Tooltip: "Tap any amount for details" [S/M].
- **Sorting** (`_resultsSorting`, `toggleSortMode`): Standard / By Amount / By Name / By Frequency / By Last Used [S].
- **Toggles**: include **Transfers as Income and Expenses**, **Adjustments as Income and Expenses** (§4.30), **Include scheduled transactions** (`_includingScheduledShort`, shown when available), Summary amounts rounding [S/M].
- **Filter**: nav-bar filter button (tooltip "ADDITIONAL FILTER"); shows "Filter applied" when active (§4.14) [S/M].
- **Account/group** selector in the nav bar (`accountSelector`) and the currency in which sums are reported (group report currency or the **General Currency**). A "Comparison Currency" ("Quickly estimate the amount in another currency") can be shown for sums [S/M].
- **Export**: "Export Report" (§4.46) [S].
- **Empty state**: "No Data" [S].
- **Persistence** [M]: last overview type (`LAST_OVERVIEW_TYPE`), the period group and offset (`OVERVIEW_PERIOD_SELECTOR_*`), the details mode (`OVERVIEW_DETAILS_SHOW_MODE`), the sort (`OVERVIEW_SORT`).
- **PRO**: Report filter, interactive bar chart and subperiod splits are PRO features ("Report Filter", "Interactive Bar Chart") with a demo mode for non-PRO users (`allowAllProFeaturesForNonProUsers`, `isAllowedProForDemoMode`) [S/M].

### 4.11 Report options (`ReportOptionsViewController`)
- Title "Screen Options" (`_screenOptions`). Includes: results sorting, show chart, combine small values (with threshold), show balance, "Transactions Count", transfers/adjustments as income/expenses, and the displayed attributes [S/I]. Changes post `_REPORT_OPTIONS_CHANGED` [M].

### 4.12 Pie chart (`PieChartViewController`, `OverviewChartType`)
- Slices per result item using each item's color. "Other" aggregation per §4.10. A selected slice is highlighted, and the center or an info cell shows the item and its sum/percentage [M/I].

### 4.13 Bar chart (`BarChartViewController`, `BarChartView`, `BarsChart`)
- **Purpose**: compare income/expenses over **subperiods** ("Analyze income and expenses on a bar chart: compare days, weeks, months, and years").
- **Content**: a bar series for the subperiods of the selected period, with a **subperiod selector** (`subperiodTypesForPeriod:`, e.g. All Subperiods; the choice is saved per period type: `saveSubperiodType`/`loadSubperiodType`, `yearSubperiodsTypePersistentKey`), axis labels via a dates/numbers axis generator with an overlap solver, a **budget line** (`BAR_CHART_BUDGET_LINE`) when a budget exists, **stacked/split** bars (`isSplitEnabled`, `calcSplittedSumsForPeriod:`: split by the report breakdown), the activity indicator, a no-data view, and a PRO lock badge/button (`configureProButton`, `showPro`) [M/S].
- **Interaction**: tap a bar → `selectBarChartItem:` selects that subperiod; the selection callback (`selectAction`) lets the Report change period [M].
- **PRO**: PRO or demo only [S].

### 4.14 Filter (`FilterViewController`)
- **Purpose**: "Filter data by categories, tags, payers, and payees" ("Report Filter") [S].
- **Content**: a **Filter Mode** (Include / Exclude, `_filterModeInclude/Exclude`) with the sections "What to Include" / "What to Exclude" (`_whatToInclude`, `_whatToExclude`), covering categories (multi-select tree), tags, counterparties (and places [I]). Actions: **Apply Filter**, **Remove Filter**, and the "Filter applied" indicator [S/M].
- Used by the Report, the Bar chart, and the transaction-list drill-downs (the `Filter` object is passed in) [M].

### 4.15 Plan (`GoalsBudgetsViewController`)
- **Purpose**: goals and budgets overview (nav title "Plan"; `_plan`) [S].
- **Content**: a table with two "superheader" sections, **Goals** (`goalsHeaderCell`) and **Budgets** (`budgetsHeaderCell`), each with an **Add** action ("Add Goal" / "Add Budget"; `addGoal`/`addBudget`). Sticky superheaders (`updateSuperheadersStateForced:`) [M].
  - **Goals**: goal cells (`HWGoalTableViewCell`) with icon/color, name, a progress bar (`GoalProgressView`), **Saved** amount (`_goalSaved`), **Remaining** (`_goalRemaining`), target and "by <date>", status "Goal Achieved" or "Overdue" [S/M].
  - **Budgets**: grouped by **period type** (year / month / week / day…: `budgetFirstPeriodType`, `budgetsByPeriodType`), each group having a header with a **period selector** (`HWBudgetsPeriodSelectorTableViewCell`, the current period per type) and a limit/total. Budget cells show name/icon, **Expense / Limit** or **Available** or other forms based on the setting "Budget Amount" (`_budgetsSumType`: Expense / Limit / Available / "Expense / Limit") with a progress bar [S/M].
  - A budget cell tap → **Budget details** (§4.17). Tooltip: "Tap a budget for details" [S].
- **Options** (nav-bar menu, `optionsMenu`, `toggleSettingsForKey:`): the budget amount display type, and "Include scheduled transactions" [S/M].
- **Empty/hints**: inline tips on goals and budgets (Plan tips) [S].
- **PRO**: Goals and Budgets are PRO features ("Set spending limits…", "Set financial goals…"); a demo is shown with sample data [S].

### 4.16 Budget editor (Swift `BudgetEditViewController`; entity `CDBudget`)
- **Fields** [S notes + M attributes]: **Type** (Expense budget / Income budget; `type`), **Amount** ("How much you plan to spend per period", `_budgetSumNote`), **Currency**, **Period** (year / month / week / day; `_budgetsSumType`…; "Set spending limits, create budgets for a year, month, week, or day"), **Account / Account group** ("Account or account group whose expenses should be included", `_budgetAccountNote`), **Mode / what to include** ("Which expenses to include", `_budgetModeNote`: all expenses, selected **categories** (`category`/`categories`), **tags**, a **transfer** target), name/icon/color (`name`, `icon`, `color`) [S/M].
- **Actions**: Save; Delete ("Delete this budget?") [S].
- Inline tip: "A budget lets you set spending limits for a period." [S]

### 4.17 Budget details (`BudgetDetailsViewController`, subclass of the transaction list)
- Content: the budget cell (current spend vs. limit), a **period selector** cell (prev/next periods), an "Include scheduled transactions" toggle, and then **the transactions that count toward the budget** for the selected period. The nav-bar menu has Edit (`showEdit`) and Export [M/S].
- Non-PRO users see a limited view (`isProOrDemo`, `showPro`) [M].

### 4.18 Goal editor (`GoalEditViewController`; entity `CDGoal`)
- **Fields** [M ivars]: **Title**, **Icon**, **Color**, **Account** (or group; "Account or account group whose balance should be tracked", `_goalAccountNote`), **Target amount** (`sum`; "How much you want to save"; keypad), **Currency**, **Date** (optional deadline: "Optional date by which you want to reach the goal"; date selector, Clear date), a **live preview cell** (`HWGoalPreviewTableViewCell` + `previewBalanceCalculator` showing progress for the chosen account).
- **Actions**: Save, Delete ("Delete this goal?") [S].
- **Rules** [I]: progress = tracked account balance relative to the target. **Saved** = balance, **Remaining** = target − saved. Status becomes "Goal Achieved" when saved ≥ target, or "Overdue" after the date. Inline tip: "A goal helps you track your savings progress." [S]

### 4.19 Plan options → see §4.15.

### 4.20 Scheduled transactions list (`ScheduledTransactionsViewController`)
- Title "Scheduled Transactions" (Settings ▸ Scheduled Transactions; also reachable from the transaction editor) [S/M].
- **Content**: schedules grouped by status: active (next occurrence date shown), **Paused**, and **Completed** (`_completedSchedules`, `_scheduleCompletedInfo` "This schedule is completed") [S]. Row: category icon/amount/period summary ("Every %@", e.g. "Every 2 weeks"), the next date, and a pending-confirmation badge.
- **Actions**: New Scheduled Transaction (add), tap → editor (§4.21), context: Duplicate, **Show Schedule** (`_showSchedule`: the generated occurrences), **Finish** ("Finish this schedule?", `_finishSchedule(Confirm)`) [S/M].
- **Inline tip**: "With scheduled transactions you can set up automatic creation of expenses and income on a schedule." [S]
- PRO feature "Scheduled Transactions".

### 4.21 Scheduled transaction editor (entity `CDSchedule`)
- A transaction-editor variant (fields per §4.5: type, account(s), category, amount, currency, tags, counterparty, place, comment) plus **schedule controls** [M]:
  - **Repeat Period** (`_repeatPeriod`): Daily / Weekly / Monthly / Annually, with **frequency** ("Every N …").
  - **Start** (`begin`) and optional **End** (`end`) dates (`_startDate`, `_endDate`; `scheduleEndDateSelectorEnabled`).
  - **Weekday** selection for weekly repeats (`WeekdaysTableViewCell`) [M/I].
  - **Reminder** ("Reminder": none / On Time / N minutes–days "%@ before", `reminderMinutes` default −1 = none; `_atScheduledTime`) [S/M].
  - **"Wait for manual confirmation of the transaction"** (`_scheduleConfirm`, `confirm`): generated transactions stay *pending* until the user confirms [S].
  - A status line "Will be created on %@" [S].
- **Generation** [I/M]: `last` stores the last generated date and `done` the completion date. A background task and `ScheduleNotificationManager` / `PendingTransactionsManager` create due transactions on app open/refresh. A transaction created from a schedule is linked via `repeated`/`origin` and flagged in the UI. `PendingTransactionsCountDidChange` updates the badge.
- **Info**: a transaction created from a schedule shows "This transaction was created from a schedule".

### 4.22 Categories (`CategoriesViewController`)
- **Modes** (`mode`, `allowMultiselect`, `multiselectLimit`): manage list (Settings ▸ Categories) or picker (transaction, budget, filter) [M].
- **Content**: a **segmented selector Expense / Income** (`typeSelectorCell`; "Expense Category", "Income Category"), an expandable tree (parent → subcategories), a search controller, and a selected-state checkmark in picker mode. Picker extras: "Uncategorized" (unless `disableUncategorized`), "Refund" allowance (`allowRefund`), and selecting a parent can select all its subcategories (`addToSelectionAllSubcategoriesForCategory:`) [M/S].
- **Actions**: **Add Category** / Add Subcategory, edit mode (reorder via `order`, delete, edit), edit → §4.23, Delete **Category** or **Category and Subcategories** (`_deleteCategory`, `_deleteCategoryAndSubs`; confirm: "Are you sure you want to delete this category?"), with transactions retained (re-categorized or "Uncategorized" [I]) [S].
- **Rules**: subcategories are a PRO feature ("Subcategories": "Set up your income and expense structure based on your needs"), `allowSubcategoriesForNonPro` for demo. Archived categories vanish from the pickers but keep history ("An archived category disappears from the list of available ones, but its transaction history is preserved") [S].
- **Inline tip**: "You can customize the categories list: add new ones, edit existing ones, reorder them, and remove the ones you don't need." [S]
- Default tree: see [02 §4](02-data-model-and-rules.md).

### 4.23 Category editor (`CategoryEditViewController`)
- **Fields**: **Title**, **Parent Category** (`_parentCategory`; footer "Leave '%@' for a top-level category.", picker of top-level categories; hidden/limited for non-PRO), **Icon**, **Color** (shown only for top-level categories: `isColorCellAvailable`; subcategories inherit [I]), **Archive** (switch) [S/M].
- Actions: Save, Delete. Duplicate-name check [M/I].

### 4.24 Tags (`TagsViewController`)
- Manage list or picker (multi-select, `maxItemsToSelect` = 3 for a transaction [I]), a **search** bar that doubles as "add by typing" (`addItemCell`, `showNewItemWithName:`), an edit mode, a show-count option (usage `count`), an empty state, and an inline tip ("Tags are an additional way to mark transactions belonging to different categories. You can use them in reports and budgets.") [S/M].
- Menu: **Create Tag** (`_createTag`), "No Tag" option [S].
- Deleting a tag removes it from transactions (`requestDeleteTagWithName:`, `clearCacheForTagName:`) [M/I].
- PRO feature ("Tags").

### 4.25 Tag editor (`TagEditViewController`)
- Fields: **Name**, **Color**; Save, Delete. It can be launched pre-filled (`prefilledName`) from the search field of the picker. A rename updates all transactions (`replaceOldTagName:withNewName:`) [M].
- Overview footnote: "The sum for all tags may be different from the total amount, since one transaction may have multiple tags" (Report by tags) [S].

### 4.26 Counterparties (`CounterpartiesViewController`) and editor (`CounterpartyEditViewController`)
- Same structure as Tags. A **counterparty** is "a person, a store, or any other organization a transaction is linked to—someone you pay or who pays you. You can use them in reports." Labeled **Payer** on income and **Payee** on expenses. Sort button (Standard / By Name / By Frequency / By Last Used, `_sortMode*`), search/add-by-typing, edit mode, "No Counterparty", the picker's multi-select limit, and an empty state [S/M].
- Editor: **Name**, **Color**, Save, Delete (the confirmation uses the transaction count) [M].
- PRO feature ("Tags and Counterparties").

### 4.27 Currencies (`CurrenciesViewController`)
- **Purpose**: pick a currency for an account/transaction/goal/budget, or set the **General Currency** (`isGeneralSelector`) [M/S].
- **Content**: a **Favorites** section (`_favoriteCurrencies`) and "All" currencies, with a search controller (by code or name), an options menu (favorites toggling, **Update Currency Rates** `_updateCurrencyRates`, "Last Update" `_lastUpdate`), a help button, and a checkmark on the selected one [S/M].
- **Currency set** [M `BaseRates.json`, `Currencies`]: ~180 ISO-style fiat codes plus crypto (Bitcoin, Ethereum, Litecoin, Monero, Ripple, plus BTC/ETH/DASH/DOGE etc. rates). The bundled `BaseRates.json` is a USD-based rate snapshot (timestamp key 1749164400), refreshed online into `Rate` (`currency`, `time`, `value`) [M/S].
- Rates update flow: `currencyRatesDidUpdate`, `ratesUpdatedExternalyKey`, a background update (`px2.the vendor site`) [M, see [03](03-settings-sync-pro-system.md)].

### 4.28 Search (`SearchViewController`, subclass of the transaction list)
- Title "Search Transactions" (`_searchTransactionsTitle`); search bar hint "Search by any attribute" (`_searchTransactionsHint`). Matches by amount, currency, category, tags, counterparty, comment and location ("Find transactions by amount, currency, category, tags, or location") [S].
- **States**: initial state (hint), results list (the standard transaction list with row actions), "No results found" (`_searchNoResults`) [S/M]. Respects the current account/group (`currentAccountInfo`).
- PRO feature ("Transaction Search").

### 4.29 Settings (`SettingsViewController`)
Root settings table (`HWDynamicTable`) [M selectors `showCategories`, `showGeneralCurrency`, `showReminders`, `showScheduledTransactions`, `showSecurity`, `showAppearance`, `showBackups`, `showAdvanced`, `showHelp`, `showImport`, `showExport`, `showSyncLogin`/`showSyncProfile`, `showOurApps`, `showDebug`]. Structure [I, in this order or similar]:

1. **PRO cell** (`HWProTableViewCell`): "Unlock access to all features" or the PRO status and "Manage Subscription" (§4.55).
2. **Synchronization** cell: "Sign In" or the profile (email) → §4.48/4.49, with a sync status footer (`syncFooterText`, "Last Update").
3. **Categories**, **Tags**, **Counterparties** (via the Categories/Tags/Counterparties screens), **General Currency / Currencies**.
4. **Scheduled Transactions**, **Reminders**.
5. **Security**, **Appearance**, **Backups**, **Advanced Settings**.
6. **Import Transactions** / **Export Transactions**.
7. **Help** (FAQ/articles), **Send Us Feedback** / **Send Us an Email**, **Rate on the App Store**, **Our Apps**, **Privacy and Terms**, **Licenses**, app version "the app, Version %@" [S].
8. **Debug** (internal, hidden in release builds: `DebugViewController`, AB tests, PRO state, products) [M].

### 4.30 Advanced Settings (`AdvancedSettingsViewController`)
Title `_addSettings` "Advanced Settings". Rows [S/M ivars]:
- **Fixed decimal separator when entering money amounts** — "For currencies with fractional units" (`ffInputCell`).
- **Transfers as Income and Expenses** (`transfersIncExpCell`; with a help link), **Adjustments as Income and Expenses** (`adjustmentsIncExpCell`).
- **Round summary amounts to whole numbers for all currencies** (`resultsRoundingCell`).
- **Brackets** (`bracketsCell`) [M], presumably the expression/negative style [I].
- **First Day of Month: N** (`_firstMonthDayWithPlaceholder`; "Shifts the start of all monthly and yearly periods"; `ZFFirstMonthDay`).
- **Data Deletion / Delete Data** (opens §4.51).
- **Comparison currency**, "Allow Widgets to Access Data" is under Security (§4.31) [S].

### 4.31 Security (`SecurityViewController`)
- **Title** "Security"; section "Restrict Access to the App" (`_securityAccessRestriction`) [S].
- **Passcode Lock** switch (turn on → passcode setup §4.32; turn off → verify). When on: **Require** (`_requireAuthentication`: Immediately / "After %@" delay options) [S/M]. **Use Face ID / Use Touch ID** (biometry switch; the label depends on the device; reason strings "Use your face to unlock the reference app", "Use your fingerprint to unlock the reference app", "Use biometry to unlock the reference app") [S].
- **Allow Widgets to Access Data** (`widgetCell`; when the lock is on, widgets are disabled otherwise: "Widgets are disabled. Configure them in the app.") [S].
- PRO feature ("Security").

### 4.32 Passcode (`PasscodeViewController`)
- Modes: set (`settingsMode`), confirm (`confirmationMode`, "Confirm Passcode"), and verify. A PIN of `digitsCount` digits shown as bullets/empty symbols with a custom keypad, a note/title label ("Enter Passcode"), and error text "Wrong Passcode" with a shake/retry [S/M]. A cancel action; success posts a notification [M]. The passcode is stored in the Keychain (`Keychain`) [M/I].

### 4.33 Lock screen (`LockScreenViewController`)
- Shown on launch/foreground when a lock is required. Logo, lock image, a **biometrics button** and a **passcode button** (`hideAuthButtons` while authenticating), an automatic biometric prompt (LocalAuthentication) with a fallback to the passcode, and "hide all content" mode (`initWithHiddenContent`) used in the app switcher [M/S]. On success the lock screen dismisses.

### 4.34 Appearance (`AppearanceViewController`)
Rows [S/M]: **Theme** (→ §4.35), **Accent Color** (→ §4.38), **App Icon** (→ §4.37), **Navigation** (Classic/Tabs, §1.4), **Interface Scale** (`_manualFontScale`, `fontRatioCell`, a slider/stepper with preview), **Amount Style** (`_sumStyle` → §4.39), **Icon Packs** (`_iconBundles`: Base / Extended / Modern Base / Modern Extended / Outlined), and the **Add Transaction Button Position** (Left/Center/Right), among others (the Transaction List options live in §4.7).

### 4.35 Themes (`AppearanceThemesViewController`)
- Themes: **Light**, **Dark**, **Black**, **Clear Black** (`_themeTitleLight/Dark/Black/BlackMin`), split into base and PRO themes (`baseThemes`, `proThemes`). A **System** switch follows the device appearance (`toggleSystemSwitch`) and opens **Conformance** (§4.36) [S/M].

### 4.36 System appearance conformance (`AppearanceConformanceViewController`)
- "Conformance" (`_appearanceSystemConformance`): select which **dark theme** (`darkThemes`) is used when the system is dark ("Dark system theme"); the light system theme maps to Light [S/M].

### 4.37 App icon (`AppIconViewController`)
- A collection grid of alternate icons: primary plus alternates (AppIcon-3-32, 4-9-6, 4-10-1, 4-10-3, 4-12-8, _AppIcon_7_1; legacy names "classic", "modern", "mono-dark", "mono-light", "alternative"), with the sections **Classic** and **Modern** (`_classicIcons`, `_modernIcons`). Tapping one calls `setAlternateIconName` [S/M]. Some are PRO ("Thousands of icons for your categories and accounts, more customization options") [I].

### 4.38 Accent color (`AccentColorViewController`)
- Collection view with a basic palette ("Basic", `_basicColors`) and a PRO palette in sections; the selection persists in `accentColorSettingsKey` [S/M].

### 4.39 Amount style and format (`SumStyleViewController`, `SumFormatViewController`, `SumColorViewController`)
- **Amount Style**: separate styles for **Income** and **Expense** amounts: **Format** (`_sumFormat`; e.g. the sign/brackets/prefix variants rendered with a live font preview) and **Color** (palette; PRO) [S/M]. Plus the currency symbol position (`currencySymbolPosition`) [M].

### 4.40 Icon pickers (`IconBundlesViewController` → `IconsViewController`)
- Pick an icon for accounts/categories/goals: first a **bundle list** (modern vs. classic bundles, each with a preview), then a grid of **icons grouped by theme** (headers such as Animals, Baby, Beauty, Business, Cinema, City, Clothing, Finance, Food, Gaming, Healthcare, Holidays, Household, Logos, Maps, Music, Nature, Office, People, Sports, Transport, Travel, Weather… from `IconBundles.strings`). Bundles marked PRO show a PRO button/lock (`updateProButtonState`, `showPro`, `isTheBundleAvailable`). The selected icon is scrolled into view. Icon codes look like `I8IGB/wallet` (bundle/name) [M/S].
- Colors: `ColorsViewController` shows the numbered palette grid for accounts/categories/tags/goals/budgets [M].

### 4.41 Reminders (`RemindersViewController`)
- Title "Reminders". **Daily Reminder** (`_dailyReminder`) switch (requests notification permission; if disabled: "Notifications are disabled in Settings" + "Open Settings"), **Time** picker, **weekday** chips (`WeekdaysTableViewCell`), and the **Text** (default "It's time to record expenses and income") [S/M]. A footer explains availability.

### 4.42 Import entry (`ImportViewController`) — "Import Transactions"
- Intro: "Import transactions from other apps or from bank statements in CSV format." **Choose a file (.csv)** (document picker) [S].
- Free users: "1 import is available for free" / "%@ imports are available for free" (`_importFreeLimitWarning…`) [S].
- Errors: "Import Error", "Unable to properly recognize and import the data.", "Data not found", "Can't recognize data in the file", "Required assignments are missing". On failure the user can **Send File** ("You can send this file to us so we can add support for it") [S].

### 4.43 Import — columns (`ImportTransactionsViewController`, `ImportColumnAssignmentViewController`)
- **Column Assignment** (`_columnAssignment`): "Specify what each column contains". A preview of the parsed rows with per-column detected types (Text / Number / Date/Time / Currency / Empty; `_importColumnType*`) and a **"Use first row as header"** switch. Tap a column → choose its assignment: **Not Used, Date, Time, Date and Time, Amount, Amount (income), Amount (expense), Currency, Currency (income/expense), Account, Account (income/expense), Category, Counterparty, Tags, Note, Transaction Type** [S]. Auto-detection of encodings, date formats and locales (`ImportAssistant`, `detectDateFormatAndSumLocale`, `tryDetectEncoding`) [M].
- Required assignments are validated ("Required assignments are missing") [S].

### 4.44 Import — correspondence (`ImportCorrespondenceViewController`, `ImportTransactionTypesViewController`)
- "Correspondence" (`_correspondence`): maps *distinct values in the file* to app entities: **transaction types** (expense/income/transfer values), **accounts** (existing or create new), **currencies**, **categories** (expense/income) and **counterparties**. Options are auto-matched by name, with defaults (default account/currency). A "Create Automatically" shortcut exists [S/M].
- On finish: "Import completed successfully!" (`_importSuccessDetails`); new accounts/categories/counterparties are created and tagged with an `import` ref (`CDImport`) so the batch can be identified [S/M].

### 4.45 Transaction export (`TransactionExportViewController`)
- **Export to CSV** ("CSV format is supported by most spreadsheet programs."). Options: **Table Columns** (`TransactionExportColumnsViewController`: choose and order columns from the transaction fields), **Header Row**, **Total Row**, and the period/filter being exported. Result is shared via the system share sheet / a file [S/M].

### 4.46 Report export (`ReportExportViewController`)
- "Export Report": CSV of the current report (the breakdown rows, with header/total rows and a `exportTitleForCurrentReportMode` file title). Reached from the Report and from filtered lists [S/M].

### 4.47 Backups (`BackupsViewController`)
- **Intro**: "Backups let you restore your data if it's lost." "Backups are stored in your iCloud and are available in the app on all devices connected to this Apple Account." "The latest %@ backups are stored in iCloud. Older backups are deleted automatically." [S]
- **Content**: **Create Backup** button ("Backup created"); **Create Automatically** switch ("If enabled, backups will be created when data changes"); a list of backups by date/time; per-backup actions: **Restore** (confirm "Restore Data?" — "All existing data will be replaced with the data from this backup."), **Share** (JSON file), **Delete** [S/M]. Error: "No access to iCloud" [S].
- **Format**: JSON (`JSONBackup`: items, date, version, `syncAccount`) stored as `UIDocument` (`BackupDocument`) in iCloud [M].
- PRO feature ("Backups": "Protect yourself from data loss: enable automatic iCloud backups").

### 4.48 Sync sign-in / registration (`SyncLoginViewController`)
- **Purpose**: "Synchronization lets you access data across devices and manage finances together" [S]; implemented by the vendor's service ("Sync", `SyncSyncer`, `the vendor site`) [M].
- **Content**: tabs/modes **Sign In** and **Sign Up / Create New Profile**; **Email**, **Password** (rule: "Password must be at least 8 characters long and contain at least one number, one uppercase letter, and one lowercase letter"), **Forgot your password?** → **Request a One-Time Password** (OTP email: "One-time password: {OTP}"; "A one-time password has been sent. Check your inbox."), **I accept the terms of use of the the app synchronization service** (`HWSyncAgreementTableViewCell`), and **Device Name** [S].
- **When enabling sync with local data**: "Delete data on this device before syncing?" with the choices Delete / "Do not delete" (merge) [S].
- **Errors**: Wrong email or password; This email is already registered; Invalid email address; Invalid password; No Internet connection; Server access limit exceeded; Service is temporarily unavailable; Application update required; This device is disconnected from synchronization; Unknown error [S].
- PRO feature ("Cloud Sync").

### 4.49 Sync profile (`SyncProfileViewController`)
- Title "Profile". Rows: avatar/icon, **Email**, **Device name**, **Connected Devices** (§4.50), **Change Email**, **Change Password** (dialogs; "Your password has been changed"), **Log Out**, **Delete Profile** (re-auth with email and password), **Link Purchases to this Profile** ("Your purchases are linked to another profile (%@)", for PRO relinking), and **Perform Full Synchronization** (`_resetSyncCursor`) [S/M].

### 4.50 Sync sessions (`SyncSessionsViewController`)
- "Connected Devices": the list of devices with **This Device** marker, a name (rename), **Disconnect** (`_disconnectDevice`), last activity [S/M].

### 4.51 Delete Data (`DeleteDataViewController`)
- "Delete Data" (`_deleteData`). A switch per entity with its **count**: Accounts, Categories, Tags, Counterparties, Budgets, Goals, Transactions, Schedules. There are dependency rules (selecting accounts forces transactions, etc.: `checkEnabledDependencies/checkDisabledDependencies`). A **Delete** button (destructive, confirmed) [M/S].

### 4.52 Help / article (`HelpViewController`, `RemoteArticleViewController`)
- **Help**: help topics (FAQ, "Our Apps"); articles load from the vendor's website in a `WKWebView` with a stylesheet, background color matching the theme, navigation commands handled natively, a loader, and an error → close [M].
- **PRO FAQ** (on the paywall): six Q&As (Subscription management, Refund within 14 days, Lifetime equivalence, PRO on other devices, "Already bought PRO", data kept after subscription ends) [S].

### 4.53 Onboarding (Swift `OnboardingVC`, `OnboardingVM`; A/B variants)
- A paged intro (first run): **Welcome** ("Welcome to <App>, the app designed for tracking income and expenses…"), **Accounts**, **Transactions**, **Report**, **Budgets**, **Goals**, **Sync**, **Widgets**, then the **Start** button (`_onboardingDoneButtonTitle`); optional **Skip**. May lead to the paywall (`isOnboarding` mode with a skip-style close) [S/M].

### 4.54 First account creation & demo data
- On an empty database the Transactions screen offers "Let's start by creating your first account". Demo data (3 cash accounts in 3 currencies, 4 bank cards, 2 savings/goal accounts, 3 groups, 2 goals, ~13 budgets, 9 schedules, 3 tags, 9 counterparties, 9 places, transfers) can be seeded to demonstrate features; a banner invites removing it (Settings ▸ "Remove Example Data") [S/M, see [02 §7](02-data-model-and-rules.md)].

### 4.55 PRO / Paywall (`ProViewController` v2, Swift `PaywallVC` + `PaywallVM` v3; A/B tests)
- **Header**: close ("X") or skip, help, a hero image and an optional **promo countdown** (`timerLabel`, "Limited-Time Offer!", discount badge "✨ Discount %@ ✨").
- **Feature carousel** (`FeatureViewController`, auto-advancing; prev/next): Accounts and Groups / Unlimited Accounts, Subcategories, Tags and Counterparties, Interactive Bar Chart, Budgets, Goals, Scheduled Transactions, Cloud Sync, Backups, Report Filter, Transaction Search, Photos of Receipts, Security, Export, Balance Adjustment, Appearance, "And More" (descriptions in [03 §6](03-settings-sync-pro-system.md)) [S].
- **Purchase options**: **Annual**, **Monthly**, **Weekly** subscriptions (with price/period lines, "%@ per month", "%@ / year", "free trial, then price"), and **Lifetime / One-Time Purchase** ("Forever without Subscription"); a **Start Free Trial and Subscribe** CTA, "No payment now" for trials [S].
- **Footer**: auto-renew legal text (3 variants), **Restore Purchases**, **Terms of use / Privacy and Terms**, subscription management [S].
- **Variants**: "Switch to Annual Plan" offer ("Save %@ on your subscription every month/week!"), lifetime upgrade for subscribers ("You have an active annual subscription. You can also buy once and use forever."), "You have a 'Lifetime' purchase and an active subscription. Cancel it in your Apple Account settings.", "Don't forget to cancel your subscription" [S].
- **PRO status** is shared by Apple Account, or by the sync profile, with receipt validation against Apple (`verifyReceipt`) [M/S].
- **Trigger points**: tapping any PRO-gated control (`PurchaseSource` → `featureCodeForPurchaseSource:` opens the carousel on the matching feature), the settings PRO cell, and banners [M].

### 4.56 Feature page (`FeatureViewController`)
- One carousel page: an illustration, title and description for a feature; see §4.55 [M].

### 4.57 Anonymous feedback (`AnonymousFeedbackVC`)
- "Feedback": intro ("Tell us what you think of the app: what you like, what you don't, and what's missing. This feedback is anonymous, so we won't be able to reply, but we will definitely read it."), a text view (placeholder "Feedback text"), **Send** ("Thank you. Your feedback has been sent." / "Could not send feedback. Please try again later.") [S]. Alternative: **Send Us an Email** (mail composer with subject "Feedback") [S].

### 4.58 App-rating flow (`Appirater`, `AppRateManager`)
- A pre-prompt ("Do you like the app?"): **Yes** → "Thank you! Please rate the app on the App Store. It supports further development." (StoreKit review) / **Not really** → "Tell us what we can improve." (feedback, §4.57). A fallback Appirater dialog: "If you enjoy using %@, would you mind taking a moment to rate it?" with Rate / Remind me later / No, Thanks. Timing is controlled by delay parameters, and the prompt is shown in-list as an info cell [S/M].

---

## 5. Widgets (WidgetKit extension the widgets extension, intents the intents extension)

| Widget | Title / description | Config (Intent) | Families | Content |
|---|---|---|---|---|
| **Balance** | "Current Balance" — "Current balance of an account or group of accounts" | `BalanceWidgetIntent` (Account) | Small and others [M `BalanceWidgetSmallView`] | Account/group name+icon and the current balance |
| **Budget** | "Budget" — "Current state of a budget" | `BudgetWidgetIntent` (Budget) | Small, Medium, accessory circular [M] | Progress/limit; empty message "Create a budget in the the app app" |
| **Goal** | "Goal" — "Progress towards achieving a goal" | `GoalWidgetIntent` / `SelectGoalIntent` (Goal) | (small/…) [M] | Progress bar, saved/remaining; empty: "Create a goal in the the app app" |
| **New Transaction** | "New Transaction" — "Quickly create transactions" | none | (control/shortcut) [S] | Deep link to the editor |

- Widgets share data with the app through the same Core Data model, bundled rates and icons (the extension ships `the model bundle`, `BaseRates.json`, icon bundles). "Allow Widgets to Access Data" (Security) gates it; when it is off or the app is locked: "Widgets are disabled. Configure them in the app." (`AlertWidgetView`) [S/M].
- `DebugBalanceWidgetVC`, `DebugBudgetWidgetVC`, `DebugGoalWidgetVC`, `DebugComplexWidgetVC` are internal preview screens [M].

---

## 6. Message catalog (selected, by category)

### 6.1 Amount input
"Fixed decimal separator when entering money amounts — For currencies with fractional units" (§4.30); keypad cancel; expression results.

### 6.2 Confirmations
- Delete transaction: "Are you sure you want to delete this transaction?"
- Delete account: "Are you sure you want to delete this account? All transactions associated with this account will also be deleted!"
- Delete group: "Are you sure you want to delete this group?"
- Delete category: "Are you sure you want to delete this category?" (+ "Delete Category and Subcategories")
- Delete budget: "Delete this budget?"; goal: "Delete this goal?"; generic "Delete?"
- Finish schedule: "Finish this schedule?"
- Restore backup: "Restore Data? All existing data will be replaced with the data from this backup."
- Sync: "Delete data on this device before syncing?"

### 6.3 Permissions (Info.plist)
Camera and Photos ("This allows you to add photos to transactions"), Location when in use ("…remember places where transactions were made"), Face ID ("…quick and secure access to the reference app"), notifications (runtime). Location is optional, and the app works without it.
