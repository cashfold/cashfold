import type { NextConfig } from 'next';

// Client-only static export: no API routes, no server actions, nothing server-side touches user data.
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  // A fixed build id, so building the same source twice gives the same files (scripts/build-verify.mjs). Releases set BUILD_ID to the commit.
  generateBuildId: async () => process.env['BUILD_ID'] ?? 'cashfold',
  transpilePackages: ['@cashfold/core', '@cashfold/crypto', '@cashfold/protocol'],
};

export default config;
