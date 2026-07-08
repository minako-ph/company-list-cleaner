/**
 * 社名の表記正規化（FR-2）。**ルールベースのみ**（v1でLLM不使用。引継書§13 Don't）。
 *
 * normalize-jp には汎用の日本語正規化（全半角・波ダッシュ・和暦等）はあるが、
 * 「社名」固有の正規化（法人格の略記展開・前株/後株の維持）は無いため backend 側で実装する。
 * 全半角統一の基礎変換だけは normalize-jp の `toHalfWidth` を再利用する（二重実装を避ける）。
 *
 * 変換は決定的・副作用なし（同じ入力から常に同じ出力）。文字の追加推測はしない。
 * 正規化の目的は法人番号Web-API名称検索（完全一致 target=2）のヒット率を上げること。
 */

import { toHalfWidth } from '@jp-opendata/normalize-jp';

/**
 * 法人格の略記 → 正式表記の変換表。
 * - 丸括弧付き略記（`(株)` 等。全角括弧は先に toHalfWidth で半角化される）
 * - 合字1文字（㈱㈲㈳㈶ 等）
 * 略記の**出現位置は保持する**ため、前株（先頭）/後株（末尾）はそのまま維持される。
 * 曖昧な略記（例: `(合)` は合同/合名/合資のいずれとも取れる）は変換しない（推測禁止）。
 */
const CORPORATE_FORM_ABBREVIATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/㈱|\(株\)/g, '株式会社'],
  [/㈲|\(有\)/g, '有限会社'],
  [/\(同\)/g, '合同会社'],
  [/\(資\)/g, '合資会社'],
  [/\(名\)/g, '合名会社'],
  [/㈶|\(財\)/g, '財団法人'],
  [/㈳|\(社\)/g, '社団法人'],
];

/**
 * 社名を正規化する。
 * 手順: ①全半角統一（toHalfWidth。全角スペースU+3000も半角へ） →
 *       ②法人格略記の展開（位置保持＝前株/後株を維持） →
 *       ③余分な空白の畳み込み（連続空白→単一・前後trim）。
 *
 * @param input 生の社名（空文字可）
 * @returns 正規化済み社名（入力が空/空白のみなら空文字）
 */
export function normalizeCompanyName(input: string): string {
  // ① 全角英数字・記号・スペースを半角へ（全角括弧 （） も半角 () になる）。
  let s = toHalfWidth(input);
  // ② 法人格の略記を正式表記へ展開（出現位置は変えない）。
  for (const [pattern, full] of CORPORATE_FORM_ABBREVIATIONS) {
    s = s.replace(pattern, full);
  }
  // ③ 連続する空白を単一スペースへ畳み込み、前後の空白を除去する。
  return s.replace(/\s+/g, ' ').trim();
}
