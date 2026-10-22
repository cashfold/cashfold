// Constants that scripts/build.mjs substitutes when it bundles the main process (esbuild `define`). They are absent when the sources run
// unbundled (unit tests, type-checking), which build.ts handles.
declare const __CASHFOLD_SIGNED__: boolean | undefined;
declare const __CASHFOLD_TEST_FEED_ENABLED__: boolean | undefined;
declare const __CASHFOLD_VERSION__: string | undefined;
