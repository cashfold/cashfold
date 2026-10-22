// What this build was made as. Substituted at bundling time by scripts/build.mjs; the fallbacks are for unbundled runs (tests, development).

/** True only for a build whose installers were code-signed (and, on macOS, notarized). */
export const SIGNED: boolean = typeof __CASHFOLD_SIGNED__ === 'undefined' ? false : __CASHFOLD_SIGNED__;

/**
 * True only for the manual unsigned test build: it lets the updater read a local feed and trust a throwaway key, so update tests do not need
 * a real release. A release build never has it (checked by check-desktop-config); it would otherwise be an update-hijack switch.
 */
export const TEST_FEED_ENABLED: boolean = typeof __CASHFOLD_TEST_FEED_ENABLED__ === 'undefined' ? false : __CASHFOLD_TEST_FEED_ENABLED__;

/** The release version this build was made for, or undefined when running from source. */
export const BUILD_VERSION: string | undefined = typeof __CASHFOLD_VERSION__ === 'undefined' ? undefined : __CASHFOLD_VERSION__;
