import { z, type DriftReport } from '@jp-opendata/schema-buffer';

/**
 * 国税庁 法人番号Web-API Ver.4 の境界スキーマ（docs/research/houjin-webapi-v4.md）。
 *
 * XML(type=12)・CSV(type=01 Shift_JIS/type=02 Unicode)の両応答を **共通の Corporation 型**
 * （`<corporation>` 30項目・sequenceNumber〜hihyoji）へ正規化する。
 *
 * 値はすべて文字列として保全する（fast-xml-parserは parseTagValue:false、CSVは位置ベースで
 * セルを文字列のまま取り出す）。corporateNumberやpostCodeを数値化すると先頭0欠落・桁溢れの
 * リスクがあるため、数値解釈は利用側（柱3）の責務とする。
 * 未知フィールドはドリフトとしてN-4通知対象（edinetと同じ parseWithBuffer 構成）。
 */

/** レスポンス形式: 01=CSV/Shift_JIS, 02=CSV/Unicode, 12=XML/Unicode（JSONなし） */
export type HoujinResponseType = '01' | '02' | '12';

/** `<corporation>` 30項目（Ver.4で hihyoji が追加）。全項目を文字列で保全する。 */
export const houjinCorporationSchema = z
  .object({
    sequenceNumber: z.string(),
    corporateNumber: z.string(),
    process: z.string(),
    correct: z.string(),
    updateDate: z.string(),
    changeDate: z.string(),
    name: z.string(),
    nameImageId: z.string(),
    kind: z.string(),
    prefectureName: z.string(),
    cityName: z.string(),
    streetNumber: z.string(),
    addressImageId: z.string(),
    prefectureCode: z.string(),
    cityCode: z.string(),
    postCode: z.string(),
    addressOutside: z.string(),
    addressOutsideImageId: z.string(),
    closeDate: z.string(),
    closeCause: z.string(),
    successorCorporateNumber: z.string(),
    changeCause: z.string(),
    assignmentDate: z.string(),
    latest: z.string(),
    enName: z.string(),
    enPrefectureName: z.string(),
    enCityName: z.string(),
    enAddressOutside: z.string(),
    furigana: z.string(),
    hihyoji: z.string(),
  })
  .passthrough();

export type HoujinCorporation = z.infer<typeof houjinCorporationSchema>;

/** CSV/XMLパースが返すヘッダー（CSV1行目「最終更新年月日,総件数,分割番号,分割数」相当）。 */
export interface HoujinHeader {
  lastUpdateDate: string;
  /** 総件数（応答が示す全件数。分割時は分割前の総数） */
  count: number;
  divideNumber: number;
  divideSize: number;
}

/** パーサ共通の出力（ヘッダー＋法人配列＋ドリフト）。 */
export interface HoujinParseResult {
  header: HoujinHeader;
  corporations: HoujinCorporation[];
  drift: DriftReport;
}

/**
 * XML応答の境界スキーマ。
 * fast-xml-parser を isArray:'corporation' で構成するため corporation は常に配列（0件時は欠落）。
 * これにより parseWithBuffer が corporation[] の先頭要素まで再帰しドリフトを検知できる
 * （edinet の results と同じ構成）。
 */
export const houjinXmlEnvelopeSchema = z
  .object({
    corporations: z
      .object({
        lastUpdateDate: z.string(),
        count: z.string(),
        divideNumber: z.string(),
        divideSize: z.string(),
        // 0件の日は corporation 要素自体が無い → optional
        corporation: z.array(houjinCorporationSchema).optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** 30項目のCSV列順（データ行。Corporationのキーと1対1・位置対応）。 */
export const HOUJIN_CSV_COLUMNS: readonly (keyof HoujinCorporation)[] = [
  'sequenceNumber',
  'corporateNumber',
  'process',
  'correct',
  'updateDate',
  'changeDate',
  'name',
  'nameImageId',
  'kind',
  'prefectureName',
  'cityName',
  'streetNumber',
  'addressImageId',
  'prefectureCode',
  'cityCode',
  'postCode',
  'addressOutside',
  'addressOutsideImageId',
  'closeDate',
  'closeCause',
  'successorCorporateNumber',
  'changeCause',
  'assignmentDate',
  'latest',
  'enName',
  'enPrefectureName',
  'enCityName',
  'enAddressOutside',
  'furigana',
  'hihyoji',
];
