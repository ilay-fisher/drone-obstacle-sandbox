import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests share one database, so test files must not run in parallel.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
