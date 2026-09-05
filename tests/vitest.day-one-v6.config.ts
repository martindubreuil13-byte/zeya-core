import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, '..') } },
  test: {
    include: ['tests/integration/day-one-v6-real-database.test.ts', 'tests/integration/one-time-martin-qa-reset-real-database.test.ts'],
    // Both suites share one real disposable Postgres instance and use
    // identically-named temporary triggers/fixtures; running them in
    // separate parallel workers causes cross-file interference. Force
    // strictly sequential, single-file-at-a-time execution.
    fileParallelism: false,
  },
});
