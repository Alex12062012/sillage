import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
