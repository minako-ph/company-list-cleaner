import { build } from 'esbuild';

// backend を依存込みの単一 ESM バンドルにする（docs/tasks-bundling.md Step 1）。
// - external 指定なし: @google-cloud/firestore・stripe・jose・hono・workspaceパッケージを全て内包し、
//   ランタイムイメージを node_modules なしで起動可能にする。
// - minify しない: Cloud Run ログのスタックトレース可読性を優先（sourcemap も同梱）。
// - banner の createRequire: CJS 依存の `Dynamic require of "x" is not supported` 対策。
// - banner の __dirname/__filename shim: google-gax（Firestore 推移依存）がモジュールロード時に
//   __dirname を参照するため（スモークで実測・ReferenceError）。Step 1 の段階的追加ルールに従い追加。
const bannerJs = [
  "import { createRequire } from 'node:module';",
  'const require = createRequire(import.meta.url);',
  "import { fileURLToPath as __bundlerFileURLToPath } from 'node:url';",
  "import { dirname as __bundlerPathDirname } from 'node:path';",
  'const __filename = __bundlerFileURLToPath(import.meta.url);',
  'const __dirname = __bundlerPathDirname(__filename);',
].join(' ');

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  minify: false,
  banner: { js: bannerJs },
  logLevel: 'info',
});
