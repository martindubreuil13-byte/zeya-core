import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, '..') } },
  test: { include: ['tests/integration/day-one-v6-real-database.test.ts'] },
});
