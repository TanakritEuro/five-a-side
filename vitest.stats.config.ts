import { defineConfig } from 'vitest/config';

// `npm run stats`: AI match statistics for tuning (tests/stats), kept out of `npm test`.
export default defineConfig({
  test: {
    include: ['tests/stats/**/*.stats.ts'],
    testTimeout: 600_000,
  },
});
