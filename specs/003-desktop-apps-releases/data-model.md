# Data Model: Desktop Apps and Automated Releases

This feature adds **no domain data and no database change** (spec FR-002, FR-005). The entities are the spec's Key Entities, made concrete, plus the small device-local state the shell keeps. Nothing here crosses the relay.

## Release (published artifact set)

| Field | Rule |
|---|---|
| `version` | Semantic version `MAJOR.MINOR.PATCH`, no pre-release part (no beta channel at first). Equals the git tag without the `v`. Single source: root `package.json` (R-D-08). |
| `tag` | `v<version>`, created by the release proposal merge. |
| `commit` | The tagged commit; also the web `BUILD_ID`. |
| `state` | `proposed` → `drafted` → `building` → `published`, or `failed`. Only `published` is visible and only `published` is served to the updater. |
| `notes` | Generated changelog, grouped by change type, breaking changes first; plus the web tree digest and a signed/unsigned line. |
| `signed` | `true` only when every platform build was signed (macOS also notarized). Otherwise the title carries `-unsigned` and the notes say so. |
| `assets` | Installers, update feeds, `SHA256SUMS`, `sbom.cdx.json`, web export tarball (already published by the existing flow). |

State transitions:

```text
(merge to main) → proposed   release PR opened/updated, nothing public
(proposal merged = approval) → drafted   tag + draft release exist
drafted → building           release.yml gates pass, matrix running
building → published         ALL platform jobs succeeded, assets uploaded, draft flipped
building → failed            any gate or platform job failed: draft stays a draft, maintainers notified
```

`failed` is recoverable by re-running the workflow for the same tag (no new tag, no new version: FR-023).

## Installer

| Field | Rule |
|---|---|
| `os` | `win` · `mac` · `linux` |
| `arch` | `x64` · `arm64` (arm64 only on mac) |
| `format` | `nsis-exe` · `dmg` · `mac-zip` · `appimage` · `deb` · `rpm` |
| `name` | `Cashfold-<version>-<os>-<arch>.<ext>`, no spaces |
| `updateMode` | `in-app` for `nsis-exe`, `mac-zip` (signed only), `appimage`; `manual` for `deb`, `rpm`, unsigned mac |
| `sha256` | listed in `SHA256SUMS`; `sha512` listed in the update feed |
| `signature` | for `in-app` formats, `<name>.sig`: base64 Ed25519 signature of `cashfold-update-v1\n<name>\n<sha512 base64>` |

## Change (input to versioning)

| Field | Rule |
|---|---|
| `type` | Conventional Commit type of the squash-merge title: `feat`, `fix`, breaking (`!` or `BREAKING CHANGE:`), or non-shipping (`docs`, `chore`, `test`, `ci`, `build`, `style`). |
| `paths` | Files touched. A change whose files are all under the excluded paths (R-D-07) is non-shipping whatever its type. |
| `bump` | breaking → major; `feat` → minor; `fix` → patch; non-shipping → none. The highest bump among merged changes since the last release wins. |

## Update (state in the running app)

State machine kept in the main process; the renderer only displays it (see [contracts/desktop-bridge.md](contracts/desktop-bridge.md)).

```text
idle ──check──▶ checking ──▶ none            (up to date)
                          └▶ available(v)    (user told, nothing downloaded)
available ──user: download──▶ downloading(%) ──▶ ready(v)
ready ──user: install──▶ installing          (app quits, installer runs, relaunch)
any ──failure──▶ error(code)                 (previous version keeps running; retry later)
```

Rules: no transition out of `available` or `ready` happens without a user action (FR-014). `manual` mode never enters `downloading`; `available` carries the release URL. Offline: `checking` ends in `error(offline)` silently, no dialog, next check at the next interval (spec edge case). Nothing in this state is persisted except `lastCheckedAt` and `autoCheck` in the desktop-state file. `downloading → ready` additionally requires a valid project signature (`<asset>.sig`, see research R-D-10); a missing or invalid signature ends in `error(verify-failed)` and the download is deleted.

## DataLocation (read-only, derived)

| Field | Rule |
|---|---|
| `path` | Electron `userData` for the fixed app name (R-D-05). Computed in main; the renderer cannot supply or change it. |
| `kind` | `appdata-roaming` · `application-support` · `xdg-config` (display only). |

## BackupFile (existing, unchanged)

The `.cashfold-backup` produced by `backup.create` (spec 001 FR-091): one Fold, encrypted with a key derived from the user's passphrase, restorable into a new Fold with that passphrase. The desktop only brings up a native save dialog for the download (R-D-11). It never reads, writes or inspects the file's contents (spec FR-010).

## DesktopState (device-local, non-sensitive; formerly "WindowState")

`{ x, y, width, height, maximized, lastCheckedAt, autoCheck }` as JSON in `<userData>/desktop-state.json`. `autoCheck` is a boolean, default `true`: when `false`, no launch or periodic update check is made (a manual check still works). On load the bounds are clamped to a currently connected display and to sane minimums; invalid or missing values fall back to defaults. No financial data, no identifiers.

## Version display

`AboutInfo` (see contract): `version`, `buildId` (commit), `electron`, `chromium`, `os`, `arch`, `packaging` (`nsis` · `dmg` · `appimage` · `deb` · `rpm` · `unpacked`), `updateMode`, `signed`, `dataPath`, `sourceUrl` (tag of the running version). The version string is the same value that names the installer and the tag (SC-011).
