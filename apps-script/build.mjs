// apps-script のビルドパイプライン。
// src/server/main.ts を esbuild で単一バンドル（IIFE + globalName）にまとめ、
// GAS がトップレベル関数として認識できるようグローバル関数スタブを footer で生成する。
// さらに appsscript.json と sidebar.html を dist/ にコピーする（clasp push の rootDir=dist）。

import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, 'dist');

// バンドル結果を格納するグローバル変数名。GAS のトップレベル var として展開される。
const GLOBAL_NAME = 'AppsScriptEntry';

// GAS から呼び出される（トリガー・google.script.run の対象となる）エントリポイント。
// main.ts の export と一致させること。
const ENTRY_POINTS = ['onOpen', 'onInstall', 'showSidebar', 'sayHello', 'processBatch'];

// バンドルされた module の export を参照するトップレベル関数スタブ。
// 任意アリティに対応するため rest/apply を使う。
const footer = ENTRY_POINTS.map(
  (name) => `function ${name}(...args) { return ${GLOBAL_NAME}.${name}.apply(this, args); }`,
).join('\n');

mkdirSync(distDir, { recursive: true });

await build({
  entryPoints: [join(__dirname, 'src/server/main.ts')],
  bundle: true,
  format: 'iife',
  globalName: GLOBAL_NAME,
  target: 'es2020',
  charset: 'utf8',
  outfile: join(distDir, 'Code.js'),
  footer: { js: footer },
  logLevel: 'info',
});

// clasp push が拾う付随ファイルを dist/ にコピーする。
copyFileSync(join(__dirname, 'appsscript.json'), join(distDir, 'appsscript.json'));
copyFileSync(join(__dirname, 'src/sidebar/sidebar.html'), join(distDir, 'sidebar.html'));

console.log('build: dist/Code.js, dist/appsscript.json, dist/sidebar.html を生成しました');
