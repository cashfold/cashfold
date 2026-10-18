import type { NextConfig } from 'next';

// Client-only static export: no API routes, no server actions, nothing server-side touches user data.
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  transpilePackages: ['@cashfold/core', '@cashfold/crypto', '@cashfold/protocol'],
};

export default config;
