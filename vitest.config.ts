import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/host/**', 'node_modules/**', 'dist/**', 'out/**'],
    environment: 'node',
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default']
  }
});
