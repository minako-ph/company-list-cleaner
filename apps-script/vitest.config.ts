import { defineConfig } from 'vitest/config';

// ルートの vitest.config.ts（packages/* 用）を拾わないよう、apps-script 専用の設定を明示する。
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
