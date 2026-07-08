/**
 * 法人番号をキーにした情報付与サービス（FR-4＋FR-6）。
 *
 * 付与フィールドは選択式（basic / gbizBasic / subsidy / procurement）:
 * - basic:       法人番号Web-API `findByNumbers` の基本3情報（商号・所在地・法人種別）
 * - gbizBasic:   gBizINFO v2 法人基本情報（業種・設立・従業員数等）
 * - subsidy:     gBizINFO 補助金の有無＋直近件数（FR-6）
 * - procurement: gBizINFO 国等との調達の有無＋直近件数（FR-6）
 *
 * 縮退（N-7）: houjin 系 / gbizinfo 系は互いに独立。
 * - gBizINFO トークン未設定（`deps.gbiz` 無し）→ 該当フィールドをスキップし行に notice。
 * - 法人番号API 未設定（`deps.houjin` 無し）→ basic をスキップし行に notice。
 * - どちらか一方の障害でも他方は返す（フィールド単位 try/catch）。
 *
 * 行単位部分失敗（FR-8）: 1件の失敗で全体を止めず、フィールド/行に error を付けて継続。
 *
 * CR-3/CR-5: 応答を保存・キャッシュ・ログしない。logAccess も呼ばない（インボイス照会専用）。
 * 出典文言は GAS/LP 側の定数（引継書§8）のため本 API はデータのみ返す。
 */

import type { HoujinCorporation } from '@jp-opendata/gov-clients/houjin';
import type {
  GbizBasicInfo,
  GbizProcurementHojin,
  GbizSubsidyHojin,
} from '@jp-opendata/gov-clients/gbizinfo';
import { mapApiError, type ApiFieldError } from './apiError.js';

/** 法人番号の形式: 数字13桁（インボイス登録番号の `T` は付かない）。 */
const CORPORATE_NUMBER_PATTERN = /^\d{13}$/;
/** `findByNumbers` の1リクエスト上限（HOUJIN_NUM_MAX と同値）。 */
const HOUJIN_BATCH = 10;

export interface EnrichFields {
  readonly basic?: boolean;
  readonly gbizBasic?: boolean;
  readonly subsidy?: boolean;
  readonly procurement?: boolean;
}

/** フィールド単位の結果（成功=ok / 該当情報なし=not_found / 失敗=error）。 */
export type FieldOutcome<T> =
  | { readonly status: 'ok'; readonly data: T }
  | { readonly status: 'not_found' }
  | { readonly status: 'error'; readonly error: ApiFieldError };

/** basic（法人番号API 基本3情報）。 */
export interface BasicData {
  /** 商号（name）。 */
  readonly name: string;
  /** 所在地（都道府県＋市区町村＋番地）。 */
  readonly address: string;
  /** 法人種別コード（kind。例: 301）。表示名変換は GAS/LP 側の責務。 */
  readonly kind: string;
}

/** gbizBasic（gBizINFO v2 法人基本情報の主要項目。値なし項目は省略）。 */
export interface GbizBasicData {
  readonly name: string;
  readonly location?: string;
  readonly businessItems?: string[];
  readonly businessSummary?: string;
  readonly dateOfEstablishment?: string;
  readonly employeeNumber?: number;
  readonly capitalStock?: number;
  readonly representativeName?: string;
  readonly status?: string;
  readonly updateDate?: string;
}

/** 補助金/調達フラグ（有無＋直近件数。FR-6）。 */
export interface FlagData {
  readonly has: boolean;
  readonly recentCount: number;
}

export interface EnrichRow {
  readonly corporateNumber: string;
  readonly basic?: FieldOutcome<BasicData>;
  readonly gbizBasic?: FieldOutcome<GbizBasicData>;
  readonly subsidy?: FieldOutcome<FlagData>;
  readonly procurement?: FieldOutcome<FlagData>;
  /** 縮退時の通知（N-7）。設定されている場合のみ含む。 */
  readonly notices?: string[];
  /** 行単位エラー（法人番号の形式不正など。設定時はフィールド付与を行わない）。 */
  readonly error?: ApiFieldError;
}

/** basic（法人番号API）依存。1回の findByNumbers は最大 HOUJIN_BATCH 件。 */
export interface HoujinBasicDep {
  findByNumbers(numbers: string[]): Promise<HoujinCorporation[]>;
}

/** gBizINFO 依存。各メソッドは対象法人の hojin-info（先頭要素）または undefined を返す。 */
export interface GbizDep {
  getBasic(corporateNumber: string): Promise<GbizBasicInfo | undefined>;
  getSubsidy(corporateNumber: string): Promise<GbizSubsidyHojin | undefined>;
  getProcurement(corporateNumber: string): Promise<GbizProcurementHojin | undefined>;
}

export interface EnrichDeps {
  /** HOUJIN_APP_ID 未設定時は undefined（basic をスキップ）。 */
  readonly houjin?: HoujinBasicDep;
  /** GBIZINFO_API_TOKEN 未設定時は undefined（gbiz 系をスキップ）。 */
  readonly gbiz?: GbizDep;
}

function formatAddress(c: HoujinCorporation): string {
  return `${c.prefectureName}${c.cityName}${c.streetNumber}`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * 妥当な法人番号群を最大10件ずつ findByNumbers で引き、`法人番号→basic結果` の Map を作る。
 * バッチ単位の失敗は当該バッチの全番号を error にし、他バッチは継続する（FR-8）。
 */
async function resolveBasic(
  validNumbers: readonly string[],
  houjin: HoujinBasicDep,
): Promise<Map<string, FieldOutcome<BasicData>>> {
  const map = new Map<string, FieldOutcome<BasicData>>();
  const batches = chunk(validNumbers, HOUJIN_BATCH);
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const corps = await houjin.findByNumbers(batch);
        const byNumber = new Map<string, HoujinCorporation>();
        for (const c of corps) {
          // 履歴等で同一番号が複数来ても先頭（最新）を採用する。
          if (c.corporateNumber !== '' && !byNumber.has(c.corporateNumber)) {
            byNumber.set(c.corporateNumber, c);
          }
        }
        for (const n of batch) {
          const c = byNumber.get(n);
          map.set(
            n,
            c === undefined
              ? { status: 'not_found' }
              : { status: 'ok', data: { name: c.name, address: formatAddress(c), kind: c.kind } },
          );
        }
      } catch (error) {
        const fieldError = mapApiError(error, '法人番号API');
        for (const n of batch) map.set(n, { status: 'error', error: fieldError });
      }
    }),
  );
  return map;
}

/** GbizBasicInfo を GbizBasicData へ（値なし項目＝undefined は含めない・exactOptionalPropertyTypes 対応）。 */
function toGbizBasicData(info: GbizBasicInfo): GbizBasicData {
  return {
    name: info.name,
    ...(info.location !== undefined ? { location: info.location } : {}),
    ...(info.business_items !== undefined ? { businessItems: info.business_items } : {}),
    ...(info.business_summary !== undefined ? { businessSummary: info.business_summary } : {}),
    ...(info.date_of_establishment !== undefined
      ? { dateOfEstablishment: info.date_of_establishment }
      : {}),
    ...(info.employee_number !== undefined ? { employeeNumber: info.employee_number } : {}),
    ...(info.capital_stock !== undefined ? { capitalStock: info.capital_stock } : {}),
    ...(info.representative_name !== undefined
      ? { representativeName: info.representative_name }
      : {}),
    ...(info.status !== undefined ? { status: info.status } : {}),
    ...(info.update_date !== undefined ? { updateDate: info.update_date } : {}),
  };
}

async function getGbizBasic(gbiz: GbizDep, number: string): Promise<FieldOutcome<GbizBasicData>> {
  try {
    const info = await gbiz.getBasic(number);
    if (info === undefined) return { status: 'not_found' };
    return { status: 'ok', data: toGbizBasicData(info) };
  } catch (error) {
    return { status: 'error', error: mapApiError(error, 'gBizINFO') };
  }
}

async function getSubsidyFlag(gbiz: GbizDep, number: string): Promise<FieldOutcome<FlagData>> {
  try {
    const hojin = await gbiz.getSubsidy(number);
    const list = hojin?.subsidy ?? [];
    return { status: 'ok', data: { has: list.length > 0, recentCount: list.length } };
  } catch (error) {
    return { status: 'error', error: mapApiError(error, 'gBizINFO') };
  }
}

async function getProcurementFlag(gbiz: GbizDep, number: string): Promise<FieldOutcome<FlagData>> {
  try {
    const hojin = await gbiz.getProcurement(number);
    const list = hojin?.procurement ?? [];
    return { status: 'ok', data: { has: list.length > 0, recentCount: list.length } };
  } catch (error) {
    return { status: 'error', error: mapApiError(error, 'gBizINFO') };
  }
}

/**
 * 法人番号群へ選択フィールドを付与する。入力順を保つ。
 * basic は先にまとめてバッチ照会し、gbiz 系は番号ごとにフィールド単位で照会する
 * （すべて注入側の直列キュー経由で送信される）。
 */
export async function enrichCorporations(
  numbers: readonly string[],
  fields: EnrichFields,
  deps: EnrichDeps,
): Promise<EnrichRow[]> {
  const validNumbers = numbers.filter((n) => CORPORATE_NUMBER_PATTERN.test(n));

  // basic（バッチ照会）を先に解決しておく。
  const basicMap =
    fields.basic === true && deps.houjin !== undefined
      ? await resolveBasic(validNumbers, deps.houjin)
      : undefined;

  return Promise.all(
    numbers.map(async (number): Promise<EnrichRow> => {
      if (!CORPORATE_NUMBER_PATTERN.test(number)) {
        return {
          corporateNumber: number,
          error: { code: 'invalid_format', message: '法人番号は数字13桁で指定してください' },
        };
      }

      const notices: string[] = [];

      let basic: FieldOutcome<BasicData> | undefined;
      if (fields.basic === true) {
        if (deps.houjin !== undefined) {
          basic = basicMap?.get(number) ?? { status: 'not_found' };
        } else {
          notices.push('法人番号APIが未設定のため基本情報の付与をスキップしました');
        }
      }

      let gbizBasic: FieldOutcome<GbizBasicData> | undefined;
      if (fields.gbizBasic === true) {
        if (deps.gbiz !== undefined) {
          gbizBasic = await getGbizBasic(deps.gbiz, number);
        } else {
          notices.push('gBizINFOトークンが未設定のため法人基本情報（gBizINFO）をスキップしました');
        }
      }

      let subsidy: FieldOutcome<FlagData> | undefined;
      if (fields.subsidy === true) {
        if (deps.gbiz !== undefined) {
          subsidy = await getSubsidyFlag(deps.gbiz, number);
        } else {
          notices.push('gBizINFOトークンが未設定のため補助金情報をスキップしました');
        }
      }

      let procurement: FieldOutcome<FlagData> | undefined;
      if (fields.procurement === true) {
        if (deps.gbiz !== undefined) {
          procurement = await getProcurementFlag(deps.gbiz, number);
        } else {
          notices.push('gBizINFOトークンが未設定のため調達情報をスキップしました');
        }
      }

      return {
        corporateNumber: number,
        ...(basic !== undefined ? { basic } : {}),
        ...(gbizBasic !== undefined ? { gbizBasic } : {}),
        ...(subsidy !== undefined ? { subsidy } : {}),
        ...(procurement !== undefined ? { procurement } : {}),
        ...(notices.length > 0 ? { notices } : {}),
      };
    }),
  );
}
