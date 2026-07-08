/**
 * 列マッピング推定・出力列定義・ステータス判定（純関数。GAS 非依存で vitest テスト可能）。
 *
 * - `guessColumnMapping`（FR-1）: ヘッダー名から社名/法人番号/登録番号列を推定する。
 *   本ツールが生成した出力列（OUTPUT_COLUMNS のヘッダー）は推定対象から除外する
 *   （出力列を入力列と誤認しないため。C4/C6 の取りこぼし防止）。
 * - 出力列（FR-7）: 結果は新規列として追記する。列はヘッダー名（固定文字列）で識別・再利用する。
 * - ステータス（FR-7/FR-8）: '成功' 以外を再実行対象とする（真実源）。
 */

/** サイドバーで指定する入力列（1始まりの列番号。未指定は undefined）。 */
export interface ColumnMapping {
  nameCol?: number;
  corpNumCol?: number;
  regNumCol?: number;
}

/**
 * 本ツールが生成する出力列（FR-7）。id は内部識別子、header はシートに書くヘッダー名。
 * ヘッダー名は固定文字列で、再実行時はこの名前で既存列を探して再利用する（新規追記しない）。
 * 表示順（サイドバーや列作成順）にも使う。
 */
export const OUTPUT_COLUMNS = [
  { id: 'normalizedName', header: '正規化社名' },
  { id: 'corporateNumber', header: '法人番号(結果)' },
  { id: 'address', header: '所在地(結果)' },
  { id: 'kind', header: '法人種別' },
  { id: 'gbizIndustry', header: '業種(gBizINFO)' },
  { id: 'gbizEstablished', header: '設立年月日(gBizINFO)' },
  { id: 'gbizEmployees', header: '従業員数(gBizINFO)' },
  { id: 'subsidy', header: '補助金' },
  { id: 'procurement', header: '調達実績' },
  { id: 'invoice', header: 'インボイス登録' },
  { id: 'status', header: 'ステータス' },
] as const;

/** 出力列の内部識別子の型。 */
export type OutputColumnId = (typeof OUTPUT_COLUMNS)[number]['id'];

/** 出力列ヘッダー名の集合（推定除外・存在判定に使う）。 */
const OUTPUT_HEADERS: ReadonlySet<string> = new Set(OUTPUT_COLUMNS.map((c) => c.header));

/** ステータス列の値（FR-7）。'成功' 以外は再実行対象（FR-8）。 */
export const STATUS = {
  /** 正常に処理が完了した行。 */
  success: '成功',
  /** 候補が複数で自動確定できず、ユーザーの候補選択を待つ行（FR-3）。 */
  pending: '候補選択待ち',
  /** まだ処理していない行。 */
  unprocessed: '未処理',
} as const;

/** エラー理由付きのステータス文字列を作る（FR-7）。 */
export function statusError(reason: string): string {
  return `エラー: ${reason}`;
}

/**
 * 再実行対象か（FR-8）。'成功' 以外（空・未処理・候補選択待ち・エラー）はすべて対象。
 * 前後空白は無視する。
 */
export function isReprocessTarget(status: string): boolean {
  return status.trim() !== STATUS.success;
}

/** ヘッダーセルの生値を正規化した文字列にする（null/数値も安全に扱う）。 */
function normalizeHeader(raw: unknown): string {
  return raw === null || raw === undefined ? '' : String(raw).trim();
}

/**
 * ヘッダー名から列の役割を推定する（FR-1）。leftmost 一致を採用する。
 * 出力列ヘッダー（OUTPUT_HEADERS）は推定から除外する。
 * 判定順は 法人番号 → 登録番号 → 社名（'法人番号' を含む見出しを社名に取られないため）。
 *
 * @param headers ヘッダー行のセル値（0始まり配列。1列目が index 0）
 * @returns 1始まりの列番号を持つマッピング（該当なしはキー未設定）
 */
export function guessColumnMapping(headers: readonly unknown[]): ColumnMapping {
  const nameKeywords = ['社名', '会社名', '企業名', '法人名', '商号', '取引先名', '取引先', '名称'];
  const corpKeywords = ['法人番号', '法人ナンバー'];
  const regKeywords = ['登録番号', '適格', 'インボイス', 't番号'];

  const mapping: ColumnMapping = {};
  headers.forEach((raw, index) => {
    const header = normalizeHeader(raw);
    if (header === '' || OUTPUT_HEADERS.has(header)) return;
    const lower = header.toLowerCase();
    const col = index + 1;

    if (mapping.corpNumCol === undefined && corpKeywords.some((k) => header.includes(k))) {
      mapping.corpNumCol = col;
      return;
    }
    if (mapping.regNumCol === undefined && regKeywords.some((k) => lower.includes(k))) {
      mapping.regNumCol = col;
      return;
    }
    if (mapping.nameCol === undefined && nameKeywords.some((k) => header.includes(k))) {
      mapping.nameCol = col;
    }
  });
  return mapping;
}
