/**
 * 候補選択の適用（FR-3）。GAS 依存。
 *
 * ユーザーが ambiguous 行で選んだ法人番号をシートの「法人番号(結果)」出力列へ書き込み、
 * ステータスを '成功' へ更新する（confidence は 'selected' 相当＝ユーザー選択で確定）。
 * 付与（住所・インボイス等）が必要なら、選択後に「未処理・エラー行のみ再実行」ではなく
 * 通常の再実行で当該行を含めて実行すると、既存の法人番号(結果)列を再利用して付与される。
 */

import { ensureOutputColumns, writeRowOutputs, getSheetByNameOrThrow, type RowOutput } from './sheet';
import { STATUS } from './columns';
import { extractDigits, isCorporateNumber } from './format';

/** applyCandidate の戻り値。 */
export interface ApplyCandidateResult {
  readonly row: number;
  readonly corporateNumber: string;
  readonly status: string;
}

function asObject(v: unknown): object {
  if (typeof v !== 'object' || v === null) throw new Error('リクエストが不正です。');
  return v;
}

/**
 * ユーザー選択した候補を適用する（FR-3）。
 * @param raw `{ sheetName, headerRow, row, corporateNumber }`
 */
export function applyCandidate(raw: unknown): ApplyCandidateResult {
  const o = asObject(raw);
  const sheetName = Reflect.get(o, 'sheetName');
  const headerRow = Reflect.get(o, 'headerRow');
  const row = Reflect.get(o, 'row');
  const corporateNumberRaw = Reflect.get(o, 'corporateNumber');

  if (typeof sheetName !== 'string' || sheetName === '') {
    throw new Error('対象シートが指定されていません。');
  }
  if (typeof headerRow !== 'number' || !Number.isInteger(headerRow) || headerRow < 1) {
    throw new Error('ヘッダー行が不正です。');
  }
  if (typeof row !== 'number' || !Number.isInteger(row) || row < 1) {
    throw new Error('対象行が不正です。');
  }
  const corporateNumber = extractDigits(corporateNumberRaw);
  if (!isCorporateNumber(corporateNumber)) {
    throw new Error('選択した候補の法人番号が不正です。');
  }

  const sheet = getSheetByNameOrThrow(sheetName);
  const outCols = ensureOutputColumns(sheet, headerRow, ['corporateNumber', 'status']);
  const output: RowOutput = {
    row,
    cells: { corporateNumber, status: STATUS.success },
  };
  writeRowOutputs(sheet, outCols, [output]);

  return { row, corporateNumber, status: STATUS.success };
}
