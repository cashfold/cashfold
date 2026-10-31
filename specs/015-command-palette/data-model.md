# Data Model: Command Palette

Nothing here is a domain concept, an event or a synced record. These are page-level types plus one small device-local store.

## 1. Palette entry (in memory only)

What the list shows for one row. Built each time the palette opens; never stored.

| Field | Meaning |
|-------|---------|
| `id` | Opaque, stable identifier: `a:<accountId>`, `e:<budgetId>`, `g:<goalId>`, `c:<commandId>`. Also the key into history. |
| `type` | `screen`, `action`, `account`, `envelope` or `goal`. Drives the group heading and ordering. |
| `title` | The display name (translated for screens and actions; the person's own name for accounts, envelopes, goals). |
| `secondary` | Optional short line to tell duplicates apart: the group or currency for an account, the period for an envelope, the target for a goal. |
| `keywords` | Extra words that should match, translated (for example "dark" for Switch theme). Not shown. |
| `run` | What choosing it does; receives the palette context (see the contract). |

**Rules**: a row is built only from data the ledger hook already holds or the two existing queries return; titles are never written anywhere. Rows are limited to the Fold being viewed (spec clarification 1).

## 2. Command (registry)

A registered screen or action. Contributed once, at module load.

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Stable id, for example `add-transaction`. Becomes `c:<id>` in history. |
| `titleKey` | message key | The translated name. |
| `keywordKeys` | message keys | Extra match words. |
| `group` | `screen` or `action` | Heading and ordering. |
| `enabled` | `(ctx) => boolean` | Whether it is offered now (for example Add transaction only when an account exists). |
| `run` | `(ctx) => void` | Calls the same entry point as the normal control. |

**Validation**: ids are unique (registering a duplicate throws in development and is ignored in production); a command with no title key is rejected by the tests.

## 3. Match result

| Field | Meaning |
|-------|---------|
| `score` | Higher is better; 0 means "matches everything" (empty query). Not a match is `undefined`. |
| `ranges` | Sorted, non-overlapping `[start, end)` indices in the original title, for highlighting. |

## 4. History record (device-local)

Stored under `localStorage['cashfold.palette']` as:

```text
{ "v": 1, "items": [ { "id": "a:…", "n": 7, "t": 1761900000000 }, … ] }
```

| Field | Meaning |
|-------|---------|
| `id` | The entry id from section 1. Opaque; no names. |
| `n` | How many times it was opened or run (integer, at least 1, capped at 9999). |
| `t` | Last used, milliseconds since the epoch. |

**Rules**
- At most 24 items. When full, the item with the lowest `n` (oldest `t` as tie-break) is dropped first.
- An unknown version, a non-object, an item with a wrong type, or a value over about 2 KB is discarded as a whole (starts empty); it is never repaired.
- Never contains names, amounts, query text or any other content. Never synced, exported, logged or sent.
- Removed whenever the account leaves the device (sign-out, using a different account, or removal from the device), and when the person presses "Clear palette history". The app holds one account per device, so there is one history.
- Items whose target no longer exists, or belongs to another Fold, or is not currently available, are skipped when listing. They are not removed: an item of another Fold is still valid when that Fold is viewed again, and the cap trims the least used.

## 5. State transitions (palette dialog)

```text
closed --shortcut/Help/desktop action (unlocked, no other modal)--> open (empty query)
open --type--> open (filtered)
open --Enter on a row--> closed (+ history updated, row's run executed)
open --Escape / shortcut again--> closed (focus returned)
open --lock / privacy cover / another desktop shortcut--> closed (query and rows discarded)
locked/covered --shortcut--> (no change)
```

## 6. Relationships

- A palette entry of type account/envelope/goal refers to its ledger item by id only (the same rule the domain uses for aggregates).
- A history record refers to an entry by id only; the entry is rebuilt from current data on every open, so renames show immediately.
