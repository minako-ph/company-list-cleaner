/**
 * GAS エントリポイント（会社リストクリーナー）。
 *
 * このファイルの export 関数は esbuild で単一バンドル `dist/Code.js` にまとめられ、
 * build.mjs がトップレベルのグローバル関数スタブを生成して GAS から認識可能にする。
 * OAuth スコープは appsscript.json の3点固定（CR-7）。
 */

const PRODUCT_NAME = '会社リストクリーナー';
const MENU_TITLE = PRODUCT_NAME;
const SIDEBAR_TITLE = PRODUCT_NAME;

/**
 * スプレッドシートを開いたときにカスタムメニューを追加する。
 */
export function onOpen(_e?: GoogleAppsScript.Events.SheetsOnOpen): void {
  SpreadsheetApp.getUi()
    .createMenu(MENU_TITLE)
    .addItem('サイドバーを開く', 'showSidebar')
    .addToUi();
}

/**
 * アドオンのインストール時にもメニューを追加する。
 */
export function onInstall(e?: GoogleAppsScript.Events.SheetsOnOpen): void {
  onOpen(e);
}

/**
 * サイドバー（sidebar.html）を表示する。
 */
export function showSidebar(): void {
  const html = HtmlService.createHtmlOutputFromFile('sidebar').setTitle(
    SIDEBAR_TITLE,
  );
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * 疎通確認用。アクティブなスプレッドシート名を含む挨拶文字列を返す。
 */
export function sayHello(): string {
  const name = SpreadsheetApp.getActiveSpreadsheet().getName();
  return `こんにちは。「${name}」に接続しました（${PRODUCT_NAME}）。`;
}

/**
 * バッチ処理エントリポイント（P1で実装）。
 *
 * N-2 バッチ設計: 実行主体はサイドバー側 JS とし、対象行を50行単位に分割して
 * `google.script.run.processBatch(rows, options)` を逐次呼び出す。各呼び出しは
 * 数十秒で返し、GASの6分実行制限を回避する。進捗はサイドバーで表示し、
 * 中断・再開はステータス列（FR-7）を真実源とする。
 *
 * @param rows 50行単位に分割された対象行（サイドバーから渡される）
 * @param options 列マッピング・付与項目などの処理オプション
 */
export function processBatch(rows: unknown, options: unknown): never {
  void rows;
  void options;
  throw new Error('P1で実装');
}
