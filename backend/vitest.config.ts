import { defineConfig } from 'vitest/config';

// ルートの vitest.config.ts（packages/* 用）を拾わないよう、backend 専用の設定を明示する。
// これが無いと `pnpm -r test` がルート設定を拾い "No test files found" で落ちる（apps-script で実際に発生した問題）。
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
