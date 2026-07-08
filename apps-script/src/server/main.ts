/**
 * GAS エントリポイント（会社リストクリーナー）。
 *
 * このファイルの export 関数は esbuild で単一バンドル `dist/Code.js` にまとめられ、
 * build.mjs がトップレベルのグローバル関数スタブを生成して GAS から認識可能にする。
 * OAuth スコープは appsscript.json の3点固定（CR-7）。
 */

/**
 * 追補v1.1 R3-1: UserProperties方式の動作確認用エントリポイント。GAS エディタから
 * 手動実行し（サイドバー UI からは呼ばない）、出力 JSON を docs/decisions.md へ反映して
 * UUID の生成・保存・再実行での同一性を確認する。P1 で quota 実装（無料枠カウント）に統合する。
 */
export { debugUserKeyProbe } from './userKey';

/**
 * サイドバー本実装（P1 Step6）のエントリポイント群を re-export する。
 * これらは google.script.run から呼ばれるため build.mjs の ENTRY_POINTS にも登録する。
 */
export { getSidebarInit } from './sidebarApi';
export { getUsage } from './usage';
export { processBatch, getReprocessRows } from './processBatch';
export { applyCandidate } from './candidates';
export { saveLicenseKey, getLicenseStatus, clearLicenseKey } from './license';

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

