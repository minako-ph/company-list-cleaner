import { defineConfig } from 'vitest/config';

// packages/*（柱2からのsubtree取込み分）のテストを実行する。
// apps-script のテストは各パッケージの test スクリプト（pnpm -r test）側で実行される。
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
