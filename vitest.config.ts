import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, 'src/test-utils/__mocks__/obsidian.ts'),
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
