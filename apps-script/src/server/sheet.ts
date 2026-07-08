/**
 * シート操作ユーティリティ（GAS 依存: SpreadsheetApp）。
 *
 * - ヘッダー行取得（FR-1 の推定用）。
 * - 指定範囲の対象列読み取り（N-3: getValues は対象列のみ）。
 * - 出力列の確保（FR-7: 既存セルを上書きしない・最終列の右に追記・ヘッダー名で再利用）。
 * - 結果の一括書き込み（setValues。処理対象行だけを上書きし、範囲内の他行は保持）。
 *
 * OAuth: SpreadsheetApp = spreadsheets.currentonly で完結（CR-7）。
 */

import { OUTPUT_COLUMNS, type OutputColumnId } from './columns';

type Sheet = GoogleAppsScript.Spreadsheet.Sheet;

/** アクティブなスプレッドシートから名前でシートを取得する。無ければ明示エラー。 */
export function getSheetByNameOrThrow(name: string): Sheet {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (sheet === null) {
    throw new Error(`シート「${name}」が見つかりません。対象シートを開き直してください。`);
  }
  return sheet;
}

/** ヘッダー行のセル値（文字列化）を返す。1始まりの列順（1列目が index 0）。 */
export function getHeaderRowValues(sheet: Sheet, headerRow: number): string[] {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1 || headerRow < 1) return [];
  const values = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  return values.map((v) => (v === null || v === undefined ? '' : String(v)));
}

/**
 * 1列ぶんの値を読み取る（N-3: 対象列のみ）。
 * minRow..maxRow を含む範囲を読み、行オフセット順の配列で返す。
 */
export function readColumnValues(
  sheet: Sheet,
  col: number,
  minRow: number,
  maxRow: number,
): unknown[] {
  const count = maxRow - minRow + 1;
  if (count < 1) return [];
  const values = sheet.getRange(minRow, col, count, 1).getValues();
  return values.map((r) => r[0]);
}

/** 出力列 id → ヘッダー名の定義を引く。 */
function outputHeaderOf(id: OutputColumnId): string | undefined {
  return OUTPUT_COLUMNS.find((c) => c.id === id)?.header;
}

/** ヘッダーセル値を正規化して比較用にする。 */
function normalizeHeader(raw: unknown): string {
  return raw === null || raw === undefined ? '' : String(raw).trim();
}

/**
 * 既存の出力列（ヘッダー名一致）の列番号を探す。無ければ null。
 * 再実行時に生成済み列を再利用するために使う（新規追記しないため）。
 */
export function findExistingOutputColumn(
  sheet: Sheet,
  headerRow: number,
  id: OutputColumnId,
): number | null {
  const header = outputHeaderOf(id);
  if (header === undefined) return null;
  const headers = getHeaderRowValues(sheet, headerRow);
  const index = headers.findIndex((h) => normalizeHeader(h) === header);
  return index >= 0 ? index + 1 : null;
}

/**
 * 必要な出力列を確保し、id → 1始まり列番号の対応を返す（FR-7）。
 * ヘッダー名で既存列を探し、無ければ最終列の右へ新規追記する（既存セルを上書きしない）。
 *
 * @param neededIds 確保したい出力列 id（OUTPUT_COLUMNS の表示順で処理する）
 */
export function ensureOutputColumns(
  sheet: Sheet,
  headerRow: number,
  neededIds: readonly OutputColumnId[],
): Partial<Record<OutputColumnId, number>> {
  const needed = new Set<OutputColumnId>(neededIds);
  const headers = getHeaderRowValues(sheet, headerRow);
  const result: Partial<Record<OutputColumnId, number>> = {};

  // 新規列は決定的に採番する（setValue 直後に getLastColumn() が未更新でも衝突しないよう、
  // ローカルのカウンタで next 列を進める。flush 依存を避ける）。
  let nextNewCol = Math.max(sheet.getLastColumn(), headers.length) + 1;

  // OUTPUT_COLUMNS の順で確保する（列の並びを安定させる）。
  for (const def of OUTPUT_COLUMNS) {
    if (!needed.has(def.id)) continue;
    const existingIndex = headers.findIndex((h) => normalizeHeader(h) === def.header);
    if (existingIndex >= 0) {
      result[def.id] = existingIndex + 1;
      continue;
    }
    const newCol = nextNewCol;
    nextNewCol += 1;
    sheet.getRange(headerRow, newCol, 1, 1).setValue(def.header);
    // ローカルのヘッダースナップショットも更新（同一呼び出し内の重複追記を防ぐ）。
    headers[newCol - 1] = def.header;
    result[def.id] = newCol;
  }
  return result;
}

/** 1行ぶんの出力値（出力列 id → セル文字列。未設定 id は書かない）。 */
export interface RowOutput {
  readonly row: number;
  readonly cells: Partial<Record<OutputColumnId, string>>;
}

/**
 * 処理対象行の出力値をシートへ一括書き込みする（FR-7）。
 * 各出力列について min..max の既存値を読み、対象行のセルだけ上書きして setValues する
 * （範囲内の非対象行＝再実行で処理しない行の既存値は保持する）。
 *
 * @param outCols ensureOutputColumns の戻り値（id → 列番号）
 */
export function writeRowOutputs(
  sheet: Sheet,
  outCols: Partial<Record<OutputColumnId, number>>,
  rowOutputs: readonly RowOutput[],
): void {
  if (rowOutputs.length === 0) return;
  const rows = rowOutputs.map((r) => r.row);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const span = maxRow - minRow + 1;

  for (const def of OUTPUT_COLUMNS) {
    const col = outCols[def.id];
    if (col === undefined) continue;
    const range = sheet.getRange(minRow, col, span, 1);
    const existing = range.getValues();
    let dirty = false;
    for (const ro of rowOutputs) {
      const value = ro.cells[def.id];
      if (value !== undefined) {
        existing[ro.row - minRow][0] = value;
        dirty = true;
      }
    }
    if (dirty) range.setValues(existing);
  }
}
