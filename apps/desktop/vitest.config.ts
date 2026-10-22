import { defineConfig } from 'vitest/config';

// Unit tests of the main process and preload logic run in plain Node: Electron itself is injected or mocked.
export default defineConfig({
  test: { name: 'desktop', include: ['src/**/*.test.ts'], setupFiles: ['../../vitest.setup.ts'] },
});
