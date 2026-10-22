import { readFileSync } from 'node:fs';
import type { NextConfig } from 'next';

// The release version, written into the root package.json by the release process. It is shown in Settings and equals the version of the desktop installers.
const version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? '0.0.0';

// Client-only static export: no API routes, no server actions, nothing server-side touches user data.
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  // A fixed build id, so building the same source twice gives the same files (scripts/build-verify.mjs). Releases set BUILD_ID to the commit.
  generateBuildId: async () => process.env['BUILD_ID'] ?? 'cashfold',
  transpilePackages: ['@cashfold/core', '@cashfold/crypto', '@cashfold/protocol', '@cashfold/platform'],
  env: { NEXT_PUBLIC_CASHFOLD_VERSION: version },
};

export default config;
