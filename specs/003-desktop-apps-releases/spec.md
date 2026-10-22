# Feature Specification: Desktop Apps and Automated Releases

**Feature Branch**: `003-desktop-apps-releases`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: "Desktop apps for Windows, macOS and Linux, with automated semver releases. Cashfold is currently a web app. People who track their money want to install it like a normal application, open it from the dock/start menu/launcher, and have their financial data stay reliably on their own machine. Provide installable desktop versions of the existing app for all three desktop platforms as pre-built downloads, with no change to what the app does, released automatically with semantic versions when changes are merged to the main branch."

## Clarifications

### Session 2026-10-22

- Q: Should qualifying merges publish a release automatically, or wait for maintainer approval? → A: Approval gate: qualifying merges accumulate into an automatically maintained release proposal, and a maintainer approves it to publish (one click, no manual building).
- Q: Should the exported backup file be encrypted or readable? → A: Always encrypted with the same secrets that protect the live data; restore requires the user's credentials; there is no readable export.
- Q: Should updates install automatically or only after the user agrees? → A: Notify and ask: the app tells the user a new version is available and downloads and installs it only after they agree, then restarts.
- Q: Should uninstalling the app keep or remove the user's data? → A: Keep by default, with an explicit, clearly warned "also delete my data" option during uninstall.
- Q: Where should the app store the user's data on their computer? → A: The operating system's standard application-data location, fixed; the user can see and open it but not move it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install and use Cashfold as a desktop app (Priority: P1)

A person on Windows, macOS or Linux opens the project's public releases page, downloads the installer for their operating system, installs it, and launches Cashfold from the dock, start menu or launcher. The app opens in its own window and offers the same features as the web version: the encrypted local data, sign-in, sync, and every existing screen and flow.

**Why this priority**: Without an installable, working desktop app there is nothing to release, update or sign. This is the smallest slice that delivers user value.

**Independent Test**: On a clean machine of each of the three operating systems, download the installer from the releases page, install, launch, sign in, create a transaction, quit, relaunch, and confirm the transaction is still there.

**Acceptance Scenarios**:

1. **Given** a clean machine and the releases page, **When** the user downloads and runs the installer for their operating system, **Then** Cashfold is installed and appears in the platform's standard application launcher.
2. **Given** an installed app, **When** the user launches it, **Then** it opens in its own window without needing a browser.
3. **Given** an account that already exists on the web version, **When** the user signs in on the desktop app and syncs, **Then** their data appears identically to the web version, and changes made on either side appear on the other after sync.
4. **Given** no internet connection, **When** the user opens the desktop app, **Then** every function that works offline in the web version also works offline here.

---

### User Story 2 - Keep data safe and visible on the user's machine (Priority: P1)

A person wants to be sure their financial data stays on their computer, survives restarts, browser-data clearing and app reinstalls, and can be backed up. From within the app they can see where the data is stored and export a backup file.

**Why this priority**: Reliable local data is the main reason users want a desktop app over a browser tab, and losing financial data would destroy trust.

**Independent Test**: Create data, clear all browser data on the machine, restart the computer, uninstall and reinstall the app, and confirm the data is still present. Export a backup and confirm it can be restored on a clean install.

**Acceptance Scenarios**:

1. **Given** data created in the desktop app, **When** the user restarts the app or the computer, **Then** the data is unchanged.
2. **Given** data created in the desktop app, **When** the user clears their web browser's data, **Then** the desktop app's data is unaffected.
3. **Given** data in the desktop app, **When** the user uninstalls and reinstalls the app, **Then** the data is still available, unless the user explicitly chose to delete it during uninstall.
4. **Given** the app's settings, **When** the user looks for the data location, **Then** the app shows where on disk their data is stored and offers to open that folder.
5. **Given** the app's settings, **When** the user requests a backup, **Then** the app writes an encrypted backup file to a location they choose, and importing that file on another installation with the user's credentials restores the data.

---

### User Story 3 - Receive updates without reinstalling (Priority: P2)

When a new version is published, an installed app notices, tells the user, and, once the user agrees, downloads and installs the update without a manual reinstall. Nothing is installed without the user's consent. On platform package formats that cannot update themselves, the app clearly tells the user how to update.

**Why this priority**: Without updates, users run stale and possibly insecure versions of a finance app, and every release would require manual effort from every user.

**Independent Test**: Install an older release, publish a newer one, and confirm the installed app detects it, updates, restarts into the new version, and retains all data.

**Acceptance Scenarios**:

1. **Given** an older installed version and a newer published release, **When** the app checks for updates, **Then** it informs the user that a new version is available and shows the new version number.
2. **Given** the user accepts the update, **When** the update completes, **Then** the app restarts on the new version and all existing data is intact and readable.
3. **Given** an installation format that cannot update itself, **When** a newer version exists, **Then** the app tells the user what to do (for example, where to download the new version) instead of failing silently.
4. **Given** no internet connection, **When** the app tries to check for updates, **Then** it does not block or disturb any other function and tries again later.
5. **Given** an update that fails or is interrupted, **When** the app is next opened, **Then** the previous working version still runs and data is intact.
6. **Given** an update whose authenticity cannot be verified (altered, wrongly signed, or not published by the project), **When** the app has downloaded it, **Then** it is refused and deleted, the user is told the update could not be verified, and the installed version keeps running with its data intact.
7. **Given** the user has switched off automatic update checks, **When** the app starts or time passes, **Then** it makes no update request, and the user can still check manually on demand.

---

### User Story 4 - Maintainers publish releases automatically with semantic versions (Priority: P2)

A maintainer merges changes to the main branch. The next version number is calculated automatically from the commit history (a fix raises the patch number, a feature raises the minor number, a breaking change raises the major number) and a changelog is produced, both shown in an automatically maintained release proposal. When a maintainer approves the proposal, installers for all three operating systems are built and attached to a public release, without anyone building or uploading anything by hand. A change that does not affect shipped behaviour (documentation, chores, tests, build-pipeline-only changes, server-only changes) does not publish a new desktop release.

**Why this priority**: Automation is what makes the desktop apps sustainable to ship, and predictable version numbers let users and maintainers understand what each release contains.

**Independent Test**: Merge a sample set of changes (one fix, one feature, one breaking change, one documentation-only change, one server-only change) and confirm each produces the expected outcome: patch, minor, major, no release, no release.

**Acceptance Scenarios**:

1. **Given** merged changes that affect shipped behaviour, **When** the release process runs, **Then** a release proposal showing the next version and changelog is created or updated, and nothing is published until a maintainer approves it.
2. **Given** a merged fix affecting shipped behaviour and an approved proposal, **When** the release process runs, **Then** a new release is produced with the patch number increased and a changelog entry for the fix.
3. **Given** a merged feature, **When** the release process runs, **Then** the minor number increases and the changelog lists the feature.
4. **Given** a merged breaking change, **When** the release process runs, **Then** the major number increases and the changelog marks the change as breaking.
5. **Given** a merge containing only documentation, chores, tests, build-pipeline or server-only changes, **When** the release process runs, **Then** no new desktop release is published.
6. **Given** a new release, **When** a maintainer opens the releases page, **Then** they see the version, the release notes and a download for each supported platform and format.
7. **Given** a release in progress, **When** the build for any one platform fails, **Then** no release is published at all and the maintainers are told which platform failed.
8. **Given** a published release, **When** the user opens the app's About or settings view, **Then** the version shown equals the release version exactly.

---

### User Story 5 - Installers that the operating system trusts (Priority: P3)

A person installs Cashfold and their operating system does not warn that the app is from an unidentified or untrusted developer. Installers are digitally signed, and on macOS also notarized. Until signing is in place, unsigned builds may be published only if they are clearly labelled as unsigned, with instructions for the first launch.

**Why this priority**: Trust warnings deter non-technical users from installing a finance app, but the app is fully functional without signing, so the pipeline can be validated first.

**Independent Test**: Install the released build on a clean machine of each operating system and confirm no untrusted-developer warning is shown.

**Acceptance Scenarios**:

1. **Given** a signed release, **When** the user installs it on a clean Windows or macOS machine, **Then** the operating system shows no untrusted-developer or unidentified-publisher warning.
2. **Given** an interim unsigned release, **When** the user views the release, **Then** it is clearly labelled as unsigned and includes first-launch instructions.
3. **Given** the signing and update credentials, **When** anyone inspects the repository, release logs and published artifacts, **Then** no secret is exposed anywhere.

---

### Edge Cases

- A user updates across several versions at once (for example, from 1.2.0 straight to 1.6.0): all data must migrate correctly.
- Installed data was created by a newer version than the app currently running (for example, after a downgrade): the app must refuse to open it and explain, rather than corrupt it.
- Two instances of the app are started at the same time: only one may use the data, and the second must bring the first to the front.
- The disk is full or the data location is not writable: the app must tell the user clearly and must not lose or corrupt existing data.
- An update is available but the user is in the middle of an action: the update must wait for a safe moment and never interrupt a write.
- A user has the same account open in the web app and the desktop app: both must converge through sync as two devices would.
- Existing data in a user's browser is not automatically moved into the desktop app: the user obtains it by signing in and syncing, or by restoring a backup.
- The release process is re-run for the same commit: it must not create duplicate releases or duplicate version numbers.
- Several merges land in quick succession: versions must be assigned in order, with no gaps or collisions.
- A required quality check fails after a merge: no release is built or published for that commit.
- A platform's signing credentials are missing or expired: the release process fails visibly instead of publishing an unsigned build under a signed label.

## Requirements *(mandatory)*

### Functional Requirements

#### Desktop application

- **FR-001**: The project MUST provide installable desktop versions of Cashfold for Windows (64-bit), macOS (Apple Silicon and Intel) and Linux (64-bit), with at least one portable and one distribution-package format on Linux.
- **FR-002**: The desktop app MUST provide the same features, the same data format and the same sign-in and sync behaviour as the web app, so a user can move between web and desktop with the same account.
- **FR-003**: Every function that works offline in the web app MUST also work offline in the desktop app.
- **FR-004**: The desktop app MUST open in its own window and be launchable from each platform's standard application launcher.
- **FR-005**: The desktop app MUST NOT introduce any new product functionality beyond what is needed to install, update, back up, and display its data location and version.
- **FR-006**: The desktop app MUST keep the same privacy guarantees as the web app: no plaintext financial content, passwords or keys leave the device, and no analytics or third-party tracking is added.

#### Data safety

- **FR-007**: The user's data MUST persist across app restarts, computer restarts, clearing of web-browser data, and app reinstalls.
- **FR-008**: Uninstalling the app MUST keep user data by default. Where the platform's uninstaller allows choices, it MUST offer an explicit "also delete my data" option with a clear warning; data MUST NOT be deleted unless the user selects it. Where the platform offers no such choice, the app MUST show instructions for removing the data manually.
- **FR-009**: The app MUST store user data in the operating system's standard per-user application-data location, which is fixed and not user-configurable. The app MUST show the user where their data is stored and let them open that location.
- **FR-010**: The user MUST be able to export a backup file to a location of their choice and import it to restore their data on another installation. The backup MUST always be encrypted with the same secrets that protect the live data, MUST be restorable only with the user's credentials, and MUST NOT contain any readable financial content. No unencrypted export is provided.
- **FR-011**: The app MUST refuse to open data written by a newer version than the one running, with a clear explanation, and MUST NOT alter that data.
- **FR-012**: Only one instance of the app MAY use the user's data at a time.

#### Updates

- **FR-013**: The app MUST check for new versions without blocking any other function, and MUST tolerate being offline.
- **FR-014**: The app MUST tell the user when a new version is available, and MUST download and install it only after the user agrees, then restart on the new version, with no manual download or reinstall, where the platform format allows it. The app MUST NOT install an update without the user's consent.
- **FR-015**: On formats that cannot update themselves, the app MUST tell the user clearly how to update.
- **FR-016**: Updates MUST be verified as genuinely published by the project before they are applied, on every platform and package format, including those whose operating system performs no signature check. An update that cannot be verified MUST be rejected and never installed. A failed, rejected or interrupted update MUST leave the previous working version and the data intact.
- **FR-017**: Updates MUST never interrupt a data write; they MUST wait for a safe moment.
- **FR-031**: The user MUST be able to switch off the automatic update checks (at launch and periodically) in the app's settings, with the default being on. While they are off, the app makes no update request unless the user asks for a check, and a manual check always works.
<!-- FR-031 belongs to this group but keeps the next free number so that references elsewhere stay stable. -->

#### Versioning and release automation

- **FR-018**: Each release MUST have a semantic version number, calculated automatically from the commit history: a fix raises the patch number, a feature raises the minor number, a breaking change raises the major number.
- **FR-019**: Each release MUST include an automatically generated changelog grouped by change type, with breaking changes called out.
- **FR-020**: Merges to the main branch that affect shipped behaviour MUST be collected automatically into a release proposal (next version number and changelog), kept up to date as further merges land. A maintainer MUST approve the proposal to publish the release; after approval, building, signing and uploading MUST happen without any manual step. No release is published without that approval.
- **FR-021**: Merges that do not affect shipped behaviour (documentation, chores, tests, build-pipeline-only changes, server-only changes) MUST NOT publish a new desktop release.
- **FR-022**: A release MUST be all-or-nothing: if the build for any platform fails, nothing is published, and maintainers are notified which platform failed.
- **FR-023**: Re-running the release process for the same commit MUST NOT create duplicate releases or duplicate version numbers.
- **FR-024**: The project's existing quality gates (type-check, lint, tests, bundle-size, licence and no-floating-point-money checks, and security audit) MUST pass before any release is built.
- **FR-025**: Each release MUST appear in the project's public releases page with its version, release notes and a download for every supported platform and format.
- **FR-026**: There MUST be a single source of truth for the version number; the version displayed in the app's About or settings view MUST equal the published release version exactly. The same view MUST give a link to the corresponding source code and the licence of the running version.
- **FR-027**: Each release MUST ship with checksums for every downloadable file, and with a software bill of materials, so users and auditors can verify what they downloaded.

#### Trust and secrets

- **FR-028**: Released installers MUST be digitally signed, and macOS builds MUST also be notarized. Until signing is in place, published unsigned builds MUST be clearly labelled as unsigned and include first-launch instructions.
- **FR-029**: Signing and update-verification secrets MUST NOT appear in the repository, in build logs, or in published artifacts, and MUST be available only to the release process.
- **FR-030**: The release process MUST fail visibly if signing credentials are missing or invalid, and MUST NOT publish an unsigned build as signed.

### Key Entities

- **Release**: A published, versioned set of installers for all supported platforms, with a changelog, checksums, a software bill of materials and a signed/unsigned status. Identified by its semantic version.
- **Installer**: One downloadable file for a specific operating system, architecture and format.
- **Version**: The single semantic version number that identifies a release and is shown in the app.
- **Change**: A merged unit of work classified by type (fix, feature, breaking, or non-shipping), which determines whether and how the version increases.
- **Backup file**: A user-exported file containing the user's data, restorable on any installation.
- **Update**: A newer release that an installed app detects, verifies and applies.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a clean machine of each of the three operating systems, a user can go from the releases page to a working, signed-in app in under 5 minutes.
- **SC-002**: 100% of data created in one released version is present and readable after updating to the next, verified across at least the previous three versions.
- **SC-003**: From the moment a shipping change is approved for release to downloadable installers for all platforms is under 45 minutes, with no manual intervention in building or uploading.
- **SC-004**: A documentation-only or server-only merge produces no new release, verified over a sample of at least 5 such merges.
- **SC-005**: Over a sample of merges, a fix produces a patch increase, a feature a minor increase, and a breaking change a major increase, in 100% of cases.
- **SC-006**: An installed older version detects and applies a newer release, and relaunches on it, in under 5 minutes of the user accepting the update, on all supported platforms and self-updating formats.
- **SC-007**: A user's data survives browser-data clearing, a computer restart and an uninstall/reinstall in 100% of tested cases, and a backup exported from one installation restores completely on another.
- **SC-008**: On signed releases, 0 untrusted-developer warnings are shown on clean Windows and macOS machines.
- **SC-009**: A failed build on any one platform results in 0 partially published releases.
- **SC-010**: A review of the repository, logs and artifacts of every release finds 0 exposed secrets.
- **SC-011**: The version shown in the app matches the published release version in 100% of releases.

## Assumptions

- Windows 10 and later, macOS 12 and later, and a current mainstream Linux distribution are the supported baselines, on 64-bit hardware (Intel/AMD, and Apple Silicon for macOS). Arm builds for Windows and Linux are out of scope. These are target baselines: the final minimum versions are whatever the chosen desktop runtime supports at release time, confirmed and recorded during implementation, and this assumption is updated if they differ.
- Mobile apps, store distribution (Mac App Store, Microsoft Store), native rewrites of existing features, and any new product functionality are out of scope.
- The desktop app is a shell around the existing app: web and desktop share the same features, data format and sync, and no change to the domain, cryptography or protocol is needed.
- Existing browser-held data is not auto-imported into the desktop app; users bring their data across by signing in and syncing, or by restoring a backup.
- Release gating (clarified): a release is proposed automatically after qualifying merges, and a maintainer approves it before it is published. This keeps noisy or accidental releases from reaching users' auto-update.
- No beta or pre-release channel is provided initially; every published release is a stable release. A pre-release channel may be added later.
- The project owners will obtain and own the signing credentials (an Apple Developer account for macOS signing and notarization, and a Windows code-signing identity) and provide them to the release process as protected secrets. Until then, interim unsigned builds are acceptable if clearly labelled (User Story 5).
- The project holds a dedicated update-signing key, separate from operating-system code-signing credentials, so that updates are verifiable even where the operating system offers no signature check; the app trusts only the public keys built into it.
- Commits follow the Conventional Commits format already enforced by the project; the version number is derived from it.
- The project's public releases page on its hosting service is the single download location.
- The constitution (v1.0.1) names Tauri 2 as the intended desktop shell. The choice of desktop technology belongs to planning, and if it differs from that statement, the constitution's Technology Constraints and Phasing text must be amended in the same pull request.
- Constitution rules apply in full: Conventional Commits, small squash-merged PRs, no third-party scripts or analytics, ADRs for architecture decisions, supply-chain controls (lockfile, provenance, SBOM, vulnerability scanning), an accessibility pass, and an external security review before the first production release.
