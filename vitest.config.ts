import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // AI soak tests simulate whole matches headless.
    testTimeout: 120_000,
  },
});
