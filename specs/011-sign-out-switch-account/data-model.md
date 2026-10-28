# Data Model: Sign Out and Switch Account

One new stored record, and a list of what sign-out removes or resets. No new tables, wire types or relay changes.

## Pending-erase marker (new, transient)

A record in the existing IndexedDB `device` store (`cashfold-credentials`), under its own key, written when sign-out starts and removed when it ends.

| Field         | Meaning                                                         |
| ------------- | --------------------------------------------------------------- |
| `startedAtMs` | When sign-out began. Used only for logging a count, never shown |

A marker means: finish erasing before anything else. It holds no account data, email or keys.

### Lifecycle

```
(no marker) ──sign out starts──▶ marker written
marker written ──steps run, each idempotent──▶ everything erased
everything erased ──marker removed──▶ (no marker)
marker found at start ──same steps run again──▶ (no marker)
```

## What sign-out removes or resets

| Where                                     | Item                                                                                                  | Action                                                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPFS pool `/cashfold`                     | The database file, its generations and journals, which also hold attachment pieces                    | Remove every file                                                                                                                                                                   |
| IndexedDB `device`                        | Sealed credentials                                                                                    | Clear                                                                                                                                                                               |
| IndexedDB `quick`                         | Quick-unlock record                                                                                   | Clear                                                                                                                                                                               |
| IndexedDB `settings`                      | `quickUnlock.enabled`, `kitReminderDismissed`, `lastBackupAtMs`, `backupNagDismissedAtMs`             | Reset to the defaults in `DEFAULT_SETTINGS`                                                                                                                                         |
| IndexedDB `settings`                      | `autoLockMinutes`, `hiddenGraceSeconds`, `quickUnlock.maxIdleMinutes`                                 | Keep (device policy)                                                                                                                                                                |
| `localStorage` `cashfold.ui`              | `recents`, `firstRun`                                                                                 | Reset to `DEFAULT_PREFS` values                                                                                                                                                     |
| `localStorage` `cashfold.ui`              | Theme, language, optional fields, overview and plan choices, dismissed hints, archived-account choice | Keep (device preferences)                                                                                                                                                           |
| `localStorage` `cashfold.reminders.shown` | The shown-reminders list                                                                              | Remove                                                                                                                                                                              |
| Memory                                    | Session key, device signing key, account keys                                                         | Wiped by the session on lock, which sign-out does last: locking ends the worker, so the database is closed and erased, `SignedOut` is published and the marker is cleared before it |

## Result of a sign-out

| Field               | Meaning                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `deviceStillListed` | `true` when the account was on a service and the device could not be removed from its list |

## Entities from the spec

- **Account on this device**: everything in the first four rows above. At most one per device.
- **Device registration**: this device's entry in the account's device list on the service. Removed by sign-out when reachable.
- **Device preferences**: the "keep" rows.
- **Backup**: unchanged. It is the only way back for a local-only account.
