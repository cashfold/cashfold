# Data Model: Custom Primary Color

## PrimaryChoice (UI preference)
- **Values**: a palette color id (`emerald` default, plus about nine others). Unknown or missing values parse to `emerald`.
- **Stored in**: `cashfold.ui` prefs as `primary`. Device-local copy always kept, so launch and offline never wait on sync.
- **Reset**: "Reset interface settings" restores `emerald`.

## PaletteColor (static data)
- `id`, `name` message key, and per theme (`light`, `dark`): `primary`, `onPrimary`, `accentText`, `focus`.
- `icon`: file set generated for this id.
- **Rules**: every text/background pair ≥ 4.5:1 (focus ring and primary against background ≥ 3:1); `id` unique; each id has icon files.

## ProfileSettings (Phase 3 only)
- **Fields**: `primary: PaletteColorId` with a hybrid logical clock stamp (last writer wins).
- **Scope**: one per account, shared by that person's devices only; never visible to other Fold members.
- **Encryption**: key derived from the personal key set; the server holds ciphertext and routing data only.
- **Invalid or unknown value**: ignored, keeping the local value.
