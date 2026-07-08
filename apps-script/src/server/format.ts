/**
 * バックエンド応答 → シート書き込み用の表示文字列変換（純関数。GAS 非依存で vitest テスト可能）。
 *
 * - 登録番号の機械生成（CR-1）: 法人番号13桁 → `T`＋13桁（チェックデジット検証はしない。
 *   法人番号APIの結果を信頼する＝引継書§2-1・テスト指示）。
 * - found=false→'未登録' 等の表示文字列化（FR-7 の結果書き込み）。
 */

import type {
  BasicData,
  FieldOutcome,
  FlagData,
  GbizBasicData,
  InvoiceStatus,
} from './backendDto';

/** 法人番号（数字13桁）の形式。 */
const CORPORATE_NUMBER_PATTERN = /^\d{13}$/;
/** 登録番号（T＋数字13桁）の形式。 */
const REGISTRATION_NUMBER_PATTERN = /^T\d{13}$/;

/**
 * セル値（文字列・数値・null）から数字だけを取り出す。
 * 数値として読まれた法人番号（先頭ゼロ落ち・指数化のリスクは列を書式設定側で担保）に対しても
 * 文字列化してから数字を抽出する。
 */
export function extractDigits(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[^0-9]/g, '');
}

/** 数字13桁の法人番号か。 */
export function isCorporateNumber(value: string): boolean {
  return CORPORATE_NUMBER_PATTERN.test(value);
}

/** `T`＋数字13桁の登録番号か。 */
export function isRegistrationNumber(value: string): boolean {
  return REGISTRATION_NUMBER_PATTERN.test(value);
}

/**
 * 法人番号（数字13桁）から登録番号（`T`＋13桁）を機械生成する（CR-1）。
 * 13桁でなければ空文字を返す（生成不能）。チェックデジット検証はしない。
 */
export function registrationNumberFromCorporateNumber(corporateNumber: string): string {
  return isCorporateNumber(corporateNumber) ? `T${corporateNumber}` : '';
}

/** 法人種別コード（法人番号API kind）→ 表示名。未知コードはコードをそのまま返す。 */
const KIND_LABELS: Readonly<Record<string, string>> = {
  '101': '国の機関',
  '201': '地方公共団体',
  '301': '株式会社',
  '302': '有限会社',
  '303': '合名会社',
  '304': '合資会社',
  '305': '合同会社',
  '399': 'その他の設立登記法人',
  '401': '外国会社等',
  '499': 'その他',
};

/** 法人種別コードを表示名へ変換する（未知コードはそのまま）。 */
export function formatKind(kind: string): string {
  if (kind === '') return '';
  return KIND_LABELS[kind] ?? kind;
}

/** 補助金/調達フラグ（FR-6）を '有（N件）' / '無' へ。 */
export function formatFlag(flag: FlagData): string {
  return flag.has ? `有（${flag.recentCount}件）` : '無';
}

/**
 * フィールド結果（成功/該当なし/エラー）を表示文字列へ写す共通ヘルパ。
 * - error → 'エラー: <メッセージ>'
 * - not_found → '該当なし'
 * - ok → ok(data)
 * undefined（そのフィールドを付与しなかった）は undefined を返す（セルを書かない）。
 */
export function outcomeText<T>(
  outcome: FieldOutcome<T> | undefined,
  ok: (data: T) => string,
): string | undefined {
  if (outcome === undefined) return undefined;
  if (outcome.status === 'error') return `エラー: ${outcome.error.message}`;
  if (outcome.status === 'not_found') return '該当なし';
  return ok(outcome.data);
}

/** basic（法人番号API）の所在地セル値。 */
export function basicAddressText(outcome: FieldOutcome<BasicData> | undefined): string | undefined {
  return outcomeText(outcome, (d) => d.address);
}

/** basic（法人番号API）の法人種別セル値。 */
export function basicKindText(outcome: FieldOutcome<BasicData> | undefined): string | undefined {
  return outcomeText(outcome, (d) => formatKind(d.kind));
}

/** gBizINFO 業種セル値（business_items 優先、無ければ概要）。 */
export function gbizIndustryText(
  outcome: FieldOutcome<GbizBasicData> | undefined,
): string | undefined {
  return outcomeText(outcome, (d) => {
    if (d.businessItems !== undefined && d.businessItems.length > 0) {
      return d.businessItems.join(' / ');
    }
    return d.businessSummary ?? '';
  });
}

/** gBizINFO 設立年月日セル値。 */
export function gbizEstablishedText(
  outcome: FieldOutcome<GbizBasicData> | undefined,
): string | undefined {
  return outcomeText(outcome, (d) => d.dateOfEstablishment ?? '');
}

/** gBizINFO 従業員数セル値。 */
export function gbizEmployeesText(
  outcome: FieldOutcome<GbizBasicData> | undefined,
): string | undefined {
  return outcomeText(outcome, (d) => (d.employeeNumber !== undefined ? String(d.employeeNumber) : ''));
}

/** 補助金セル値（FR-6）。 */
export function subsidyText(outcome: FieldOutcome<FlagData> | undefined): string | undefined {
  return outcomeText(outcome, formatFlag);
}

/** 調達実績セル値（FR-6）。 */
export function procurementText(outcome: FieldOutcome<FlagData> | undefined): string | undefined {
  return outcomeText(outcome, formatFlag);
}

/**
 * インボイス登録状況（FR-5）をセル表示文字列へ写す。
 * - error → 'エラー: <メッセージ>'
 * - found=false → '未登録'
 * - registered=true → '登録あり（登録日 ...）'
 * - found かつ 取消済み → '取消済み（...）'
 * - found かつ 失効 → '失効（...）'
 * - それ以外（found だが registered=false・日付なし）→ '登録なし'
 */
export function formatInvoiceStatus(status: InvoiceStatus): string {
  if (status.error !== undefined) return `エラー: ${status.error.message}`;
  if (!status.found) return '未登録';
  if (status.registered) {
    return status.registrationDate !== undefined && status.registrationDate !== ''
      ? `登録あり（登録日 ${status.registrationDate}）`
      : '登録あり';
  }
  if (status.disposalDate !== undefined && status.disposalDate !== '') {
    return `取消済み（${status.disposalDate}）`;
  }
  if (status.expireDate !== undefined && status.expireDate !== '') {
    return `失効（${status.expireDate}）`;
  }
  return '登録なし';
}
