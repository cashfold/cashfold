import { defineConfig } from 'vitest/config';

// Whole-stack tests: the web app's account crypto, transports and sync service against the real relay (in process, in memory).
export default defineConfig({ test: { name: 'stack', include: ['src/**/*.test.ts'], testTimeout: 120_000, setupFiles: ['../../vitest.setup.ts'] } });
