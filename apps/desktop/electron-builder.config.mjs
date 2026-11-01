// Packaging: what goes into the installers, and for which platforms (specs/003 research R-D-09). Nothing is published from here:
// the workflows run electron-builder with --publish never and the release job uploads the files.
import { readFileSync } from 'node:fs';

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const identity = readJson('./src/main/identity.json');
const rootPackage = readJson('../../package.json');
const [, owner, repo] = new URL(identity.sourceRepoUrl).pathname.split('/');

/** The release version: the root package.json, the one place it is written (CASHFOLD_VERSION is for tests). */
const version = process.env.CASHFOLD_VERSION ?? rootPackage.version;
/** Signing is switched on by the release workflow only; without it the build is unsigned (and labelled so). */
const sign = process.env.CASHFOLD_SIGN === '1';
/** How Windows is signed when `sign` is on: azure (Trusted Signing), pfx (a certificate file; WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD are read by electron-builder), or none. */
const windowsRoute = sign ? process.env.CASHFOLD_WIN_SIGNING ?? 'none' : 'none';
/**
 * The packaged-app tests drive the app through Playwright, which attaches to Electron's main process with the Node inspector, and the
 * release build switches that off (a fuse). A test build keeps it on; every other fuse is the release value. Never for a release.
 */
const testBuild = process.env.CASHFOLD_TEST_BUILD === '1';

export default {
  appId: identity.appId,
  productName: identity.name,
  copyright: 'Copyright © Cashfold contributors',
  directories: { output: 'release', buildResources: 'build' },
  // The window icon (Linux), tray and taskbar-badge images are read at run time from inside the package.
  files: ['dist/**', 'package.json', 'build/icon.png', 'build/badges/**', 'build/tray/**'],
  extraMetadata: { version },
  // Links and files from outside (spec 006, US6; research D10). The `cashfold` scheme opens a screen for review and never carries a secret. A backup
  // opens in Cashfold by default; a CSV is offered as an alternative only ("Open with"), so Cashfold never becomes the person's CSV program unasked.
  protocols: [{ name: 'Cashfold', schemes: ['cashfold'], role: 'Viewer' }],
  fileAssociations: [
    { ext: 'cashfold-backup', name: 'Cashfold backup', description: 'Cashfold encrypted backup', mimeType: 'application/x-cashfold-backup', role: 'Editor', rank: 'Owner' },
    { ext: 'csv', name: 'CSV file', description: 'Comma-separated values', mimeType: 'text/csv', role: 'Viewer', rank: 'Alternate' },
  ],
  asar: true,
  // No spaces: GitHub rewrites spaces in asset names, which would break the update feed.
  artifactName: 'Cashfold-${version}-${os}-${arch}.${ext}',
  publish: { provider: 'github', owner, repo },
  // Hardening of the packaged Electron binary (R-D-09).
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: testBuild,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  mac: {
    category: 'public.app-category.finance',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    // Unsigned builds are signed ad hoc ("-"): Apple-silicon macOS refuses to run a modified bundle whose signature no longer matches, and a
    // build that is not signed at all fails that check after the fuses are set. Ad hoc proves nothing about who made it (it is not
    // "signed" in the sense of FR-028); Gatekeeper still warns, which the release notes explain.
    ...(sign
      ? // Developer ID signing and notarization. The certificate comes from CSC_LINK and CSC_KEY_PASSWORD (a temporary keychain that electron-builder
        // creates and removes), the notarization account from APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER. Nothing here holds a secret.
        { hardenedRuntime: true, gatekeeperAssess: false, entitlements: 'build/entitlements.mac.plist', entitlementsInherit: 'build/entitlements.mac.plist', notarize: true }
      : { identity: '-', hardenedRuntime: false }),
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    ...(windowsRoute === 'azure'
      ? {
          azureSignOptions: {
            endpoint: process.env.AZURE_TRUSTED_SIGNING_ENDPOINT,
            codeSigningAccountName: process.env.AZURE_TRUSTED_SIGNING_ACCOUNT,
            certificateProfileName: process.env.AZURE_TRUSTED_SIGNING_PROFILE,
          },
        }
      : {}),
  },
  // The uninstaller keeps the person's data unless they say otherwise (build/installer.nsh asks, default No; updates and silent runs never delete).
  nsis: { oneClick: false, allowToChangeInstallationDirectory: false, perMachine: false, deleteAppDataOnUninstall: false, include: 'build/installer.nsh' },
  linux: {
    // Without this the binary takes the package name ("@cashfolddesktop"); the packaged-app tests and the fuse check look for this one.
    executableName: 'cashfold',
    // ${arch} would give x86_64 for the AppImage and the rpm and amd64 for the deb; the release (scripts/release-assets.mjs) and the docs name all
    // three Cashfold-<version>-linux-x64.<ext>.
    artifactName: 'Cashfold-${version}-linux-x64.${ext}',
    category: 'Office;Finance',
    synopsis: 'Private, local-first personal finance',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
  },
};
